from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional, Protocol

from python.tools.srt_csv.csv_to_srt import csv_to_srt as _csv_to_srt_impl
from python.tools.srt_csv.csv_to_srt import csv_to_srt_joined as _csv_to_srt_joined_impl


class ReverseCsvEngine(Protocol):
    def csv_to_srt(
        self,
        in_path: str,
        out_path: str,
        fps: float,
        encoding: str,
        start_col: Optional[str] = None,
        end_col: Optional[str] = None,
        text_col: Optional[str] = None,
    ) -> None: ...

    def csv_to_srt_joined(
        self,
        in_path: str,
        out_dir: str,
        fps: float,
        encoding: str,
        start_col: Optional[str] = None,
        end_col: Optional[str] = None,
        text_col: Optional[str] = None,
    ) -> List[str]: ...


@dataclass(frozen=True)
class ReverseEngineAdapter:
    csv_to_srt_fn: Callable[..., None]
    csv_to_srt_joined_fn: Callable[..., List[str]]

    def csv_to_srt(
        self,
        in_path: str,
        out_path: str,
        fps: float,
        encoding: str,
        start_col: Optional[str] = None,
        end_col: Optional[str] = None,
        text_col: Optional[str] = None,
    ) -> None:
        self.csv_to_srt_fn(
            in_path,
            out_path,
            fps,
            encoding,
            start_col,
            end_col,
            text_col,
        )

    def csv_to_srt_joined(
        self,
        in_path: str,
        out_dir: str,
        fps: float,
        encoding: str,
        start_col: Optional[str] = None,
        end_col: Optional[str] = None,
        text_col: Optional[str] = None,
    ) -> List[str]:
        return self.csv_to_srt_joined_fn(
            in_path,
            out_dir,
            fps,
            encoding,
            start_col,
            end_col,
            text_col,
        )


_DEFAULT_ENGINE = ReverseEngineAdapter(
    csv_to_srt_fn=_csv_to_srt_impl,
    csv_to_srt_joined_fn=_csv_to_srt_joined_impl,
)
_ENGINE: ReverseCsvEngine = _DEFAULT_ENGINE


def get_reverse_engine() -> ReverseCsvEngine:
    return _ENGINE


def set_reverse_engine(engine: ReverseCsvEngine) -> None:
    """Install a reverse conversion engine.

    This is the extension seam for upcoming multi-country reverse parsing.
    """
    global _ENGINE
    _ENGINE = engine


def reset_reverse_engine() -> None:
    global _ENGINE
    _ENGINE = _DEFAULT_ENGINE


def csv_to_srt(
    in_path: str,
    out_path: str,
    fps: float,
    encoding: str,
    start_col: Optional[str] = None,
    end_col: Optional[str] = None,
    text_col: Optional[str] = None,
) -> None:
    _ENGINE.csv_to_srt(
        in_path,
        out_path,
        fps,
        encoding,
        start_col,
        end_col,
        text_col,
    )


def csv_to_srt_joined(
    in_path: str,
    out_dir: str,
    fps: float,
    encoding: str,
    start_col: Optional[str] = None,
    end_col: Optional[str] = None,
    text_col: Optional[str] = None,
) -> List[str]:
    return _ENGINE.csv_to_srt_joined(
        in_path,
        out_dir,
        fps,
        encoding,
        start_col,
        end_col,
        text_col,
    )


__all__ = [
    "ReverseCsvEngine",
    "ReverseEngineAdapter",
    "get_reverse_engine",
    "set_reverse_engine",
    "reset_reverse_engine",
    "csv_to_srt",
    "csv_to_srt_joined",
]
