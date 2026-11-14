"""Decode GTFS-Realtime without interpreting its fields."""

from google.transit.gtfs_realtime_pb2 import FeedMessage


def decode_gtfs_rt(payload: bytes) -> FeedMessage:
    message = FeedMessage()
    message.ParseFromString(payload)
    return message
