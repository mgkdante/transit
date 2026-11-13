"""Deterministic xz packs with capture-level integrity checks."""

import hashlib
import lzma
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from typing import Protocol

XZ_PRESET = 6
STREAM_MAX_SOURCE_BYTES = 1 << 30
_CHUNK = 64 * 1024


class BinaryWriter(Protocol):
    def write(self, data: bytes) -> object: ...


class BinaryReader(Protocol):
    def read(self, size: int = -1) -> bytes: ...


@dataclass(frozen=True)
class StreamEntry:
    index: int
    byte_offset: int
    byte_size: int
    source_bytes: int
    first_capture: int
    capture_count: int


@dataclass(frozen=True)
class PackedCapture:
    stream: int
    offset: int
    byte_size: int
    sha256: str


@dataclass(frozen=True)
class PackResult:
    byte_size: int
    sha256: str
    source_bytes: int
    streams: tuple[StreamEntry, ...]
    captures: tuple[PackedCapture, ...]


class PackCorrupt(ValueError):
    def __init__(self, message: str, capture_index: int | None = None) -> None:
        super().__init__(message)
        self.capture_index = capture_index


def write_pack(
    captures: Iterable[bytes],
    out: BinaryWriter,
    *,
    stream_max_source_bytes: int = STREAM_MAX_SOURCE_BYTES,
) -> PackResult | None:
    if stream_max_source_bytes < 1:
        raise ValueError("stream limit must be positive")
    streams: list[StreamEntry] = []
    entries: list[PackedCapture] = []
    digest = hashlib.sha256()
    size = start = source_size = first = 0
    compressor: lzma.LZMACompressor | None = None

    def emit(data: bytes) -> None:
        nonlocal size
        out.write(data)
        digest.update(data)
        size += len(data)

    def finish() -> None:
        assert compressor is not None
        emit(compressor.flush())
        streams.append(
            StreamEntry(len(streams), start, size - start, source_size, first, len(entries) - first)
        )

    for capture in captures:
        if compressor is not None and source_size + len(capture) > stream_max_source_bytes:
            finish()
            compressor = None
        if compressor is None:
            start, source_size, first = size, 0, len(entries)
            compressor = lzma.LZMACompressor(
                format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64, preset=XZ_PRESET
            )
        entries.append(
            PackedCapture(
                len(streams), source_size, len(capture), hashlib.sha256(capture).hexdigest()
            )
        )
        emit(compressor.compress(capture))
        source_size += len(capture)
    if compressor is None:
        return None
    finish()
    return PackResult(
        size,
        digest.hexdigest(),
        sum(s.source_bytes for s in streams),
        tuple(streams),
        tuple(entries),
    )


def _decoded(source: BinaryReader, stream: StreamEntry) -> Iterator[bytes]:
    decoder = lzma.LZMADecompressor(format=lzma.FORMAT_XZ)
    remaining, total = stream.byte_size, 0
    while not decoder.eof:
        data = b""
        if decoder.needs_input:
            if remaining <= 0:
                raise PackCorrupt("stream ended before its xz footer")
            data = source.read(min(_CHUNK, remaining))
            if not data or len(data) > remaining:
                raise PackCorrupt("compressed stream length differs")
            remaining -= len(data)
        chunk = decoder.decompress(data, max_length=_CHUNK)
        total += len(chunk)
        if total > stream.source_bytes:
            raise PackCorrupt("stream has excess original bytes")
        if chunk:
            yield chunk
    if remaining or decoder.unused_data or total != stream.source_bytes:
        raise PackCorrupt("stream size differs from its entry")


def read_stream(
    source: BinaryReader, stream: StreamEntry, captures: Sequence[PackedCapture]
) -> Iterator[bytes]:
    chunks = _decoded(source, stream)
    pending = b""
    offset, position = 0, stream.first_capture
    try:
        for capture in captures:
            if capture.stream != stream.index or capture.offset != offset or capture.byte_size < 0:
                raise PackCorrupt("capture layout differs")
            payload = bytearray()
            while len(payload) < capture.byte_size:
                if not pending:
                    pending = next(chunks, b"")
                    if not pending:
                        raise PackCorrupt("capture ended early")
                take = min(len(pending), capture.byte_size - len(payload))
                payload.extend(pending[:take])
                pending = pending[take:]
            if hashlib.sha256(payload).hexdigest() != capture.sha256:
                raise PackCorrupt("capture checksum differs")
            offset += len(payload)
            yield bytes(payload)
            position += 1
        if pending or next(chunks, b"") or offset != stream.source_bytes:
            raise PackCorrupt("stream contains bytes outside its captures")
        if len(captures) != stream.capture_count:
            raise PackCorrupt("capture count differs")
    except (PackCorrupt, lzma.LZMAError) as exc:
        raise PackCorrupt(str(exc), position) from exc


def read_pack(
    source: BinaryReader, streams: Sequence[StreamEntry], captures: Sequence[PackedCapture]
) -> Iterator[bytes]:
    position = offset = 0
    for index, stream in enumerate(streams):
        if (stream.index, stream.byte_offset, stream.first_capture) != (index, offset, position):
            raise PackCorrupt("stream layout differs", position)
        end = position + stream.capture_count
        yield from read_stream(source, stream, captures[position:end])
        position = end
        offset += stream.byte_size
    if position != len(captures):
        raise PackCorrupt("capture names a missing stream", position)
