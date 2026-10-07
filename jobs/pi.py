#!/usr/bin/env python3
"""Monte Carlo estimate of pi: the small CPU-bound calculation used as a test workload."""

import random
import socket
import sys


def estimate_pi(samples: int, seed: int) -> float:
    rng = random.Random(seed)
    inside = sum(
        1 for _ in range(samples) if rng.random() ** 2 + rng.random() ** 2 <= 1.0
    )
    return 4.0 * inside / samples


if __name__ == "__main__":
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    samples = int(sys.argv[2]) if len(sys.argv) > 2 else 2_000_000
    print(
        f"host={socket.gethostname()} seed={seed} samples={samples} pi~{estimate_pi(samples, seed):.5f}"
    )
