"""Deterministic FXRP/FAssets policy and receipt guard."""

from .policy import evaluate
from .receipt import evaluate_receipt

__all__ = ["evaluate", "evaluate_receipt"]
__version__ = "0.1.0"
