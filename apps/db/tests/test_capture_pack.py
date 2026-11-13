import hashlib
import io
import lzma
import random
from dataclasses import replace

import pytest

from transit_ops.history.pack import PackCorrupt, read_pack, read_stream, write_pack


def payloads():
    rng = random.Random(710)
    base = bytearray(rng.randbytes(50_000))
    items = []
    for i in range(20):
        base[i * 10 : i * 10 + 4] = rng.randbytes(4)
        items.append(bytes(base))
    return items


def packed(items, limit=1 << 30):
    out = io.BytesIO()
    result = write_pack(iter(items), out, stream_max_source_bytes=limit)
    assert result is not None
    return out.getvalue(), result


def test_pack_restores_every_capture_byte_for_byte():
    similar = payloads()
    items = similar + [similar[-1], b"", random.Random(81).randbytes(100_000)]
    data, result = packed(items)
    assert list(read_pack(io.BytesIO(data), result.streams, result.captures)) == items
    assert result.byte_size == len(data)
    assert result.sha256 == hashlib.sha256(data).hexdigest()
    assert result.source_bytes == sum(map(len, items))
    assert [c.byte_size for c in result.captures] == list(map(len, items))
    assert [c.sha256 for c in result.captures] == [hashlib.sha256(x).hexdigest() for x in items]


def test_two_streams_read_back_as_one_and_the_second_alone_by_range():
    items = payloads()[:6]
    data, result = packed(items, 100_000)
    assert len(result.streams) >= 3
    assert lzma.decompress(data) == b"".join(items)
    assert list(read_pack(io.BytesIO(data), result.streams, result.captures)) == items
    second = result.streams[1]
    source = io.BytesIO(data[second.byte_offset : second.byte_offset + second.byte_size])
    entries = result.captures[second.first_capture : second.first_capture + second.capture_count]
    assert list(read_stream(source, second, entries)) == items[2:4]
    offset = 0
    for index, stream in enumerate(result.streams):
        assert (stream.index, stream.byte_offset) == (index, offset)
        offset += stream.byte_size
    assert offset == len(data)


def test_corrupt_pack_fails_on_the_first_bad_capture():
    items = payloads()[:6]
    data, result = packed(items, 100_000)
    second = result.streams[1]
    damaged = bytearray(data)
    damaged[second.byte_offset + second.byte_size // 2] ^= 1
    reader = read_pack(io.BytesIO(damaged), result.streams, result.captures)
    for item in items[: second.first_capture]:
        assert next(reader) == item
    yielded = second.first_capture
    with pytest.raises(PackCorrupt) as error:
        for item in reader:
            assert item == items[yielded]
            yielded += 1
    assert error.value.capture_index >= second.first_capture
    assert error.value.capture_index == yielded
    with pytest.raises(PackCorrupt):
        list(read_pack(io.BytesIO(data[:-5]), result.streams, result.captures))
    _, other = packed([b"x" * 50_000] * 6, 100_000)
    with pytest.raises(PackCorrupt) as error:
        list(read_pack(io.BytesIO(data), result.streams, other.captures))
    assert error.value.capture_index == 0


def test_a_capture_larger_than_the_stream_limit_is_a_stream_of_its_own():
    items = [b"a", b"b" * 11, b"c", b""]
    data, result = packed(items, 10)
    assert [s.capture_count for s in result.streams] == [1, 1, 2]
    assert list(read_pack(io.BytesIO(data), result.streams, result.captures)) == items


def test_no_capture_writes_nothing_and_returns_none():
    out = io.BytesIO()
    assert write_pack([], out) is None
    assert out.getvalue() == b""
    with pytest.raises(ValueError):
        write_pack([], out, stream_max_source_bytes=0)


def test_the_same_captures_give_the_same_pack_bytes():
    assert packed(payloads()) == packed(payloads())


def test_similar_captures_pack_much_smaller_than_their_sum():
    data, result = packed(payloads())
    assert len(data) < result.source_bytes / 5


@pytest.mark.parametrize("field", ["source_bytes", "byte_size"])
@pytest.mark.parametrize("delta", [-1, 1])
def test_stream_size_mismatch_is_corrupt(field, delta):
    data, result = packed([b"abc", b""])
    stream = replace(result.streams[0], **{field: getattr(result.streams[0], field) + delta})
    with pytest.raises(PackCorrupt):
        list(read_pack(io.BytesIO(data + b"!"), [stream], result.captures))


def test_missing_stream_is_corrupt_and_empty_capture_round_trips():
    data, result = packed([b""])
    assert list(read_pack(io.BytesIO(data), result.streams, result.captures)) == [b""]
    with pytest.raises(PackCorrupt) as error:
        list(read_pack(io.BytesIO(data), [], result.captures))
    assert error.value.capture_index == 0


def test_reader_uses_bounded_reads_and_leaves_the_next_range_untouched():
    class ShortReader(io.BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 64 * 1024
            return super().read(min(size, 17))

    items = [b"a" * 200_000, b"", b"b" * 200_000]
    data, result = packed(items)
    source = ShortReader(data + b"next range")
    assert list(read_pack(source, result.streams, result.captures)) == items
    assert source.tell() == len(data)
