"""Guirca main photos that show the product twice.

Guirca's main photo of an article (<nr>.jpg) is often a collage: a large crop of a photo with
the same photo again, smaller, beside it or in a corner, or the product worn by a model next to
the product on its own, its packaging or a display box. is_collage() finds both kinds:

- The photo contains a scaled copy of itself: its SIFT keypoints, matched against themselves,
  give many matches that one scaling (1.3 to 6 times) maps from one part of the photo onto
  another part.
- One of the article's other photos (the catalogue photo, the product without packaging …)
  appears in it as a panel next to something else on a white canvas: the other photo's
  keypoints match the main photo, the matched region looks like the other photo pixel for pixel,
  it covers at most 90 % of the main photo, and beside it there is more content on white.

A single photo, or a scene (a product placed on a table, a party), is not a collage.

Needs numpy and opencv-python-headless (requirements.txt); only the doubles command uses it.
"""

from __future__ import annotations

import cv2
import numpy as np

WORK_SIZE = 900  # longest side the photos are scaled down to before matching

# The photo contains a scaled copy of itself.
SELF_MIN_MATCHES = 15
SELF_MIN_SCALE, SELF_MAX_SCALE = 1.3, 6.0

# Another photo of the article appears in it as a panel.
PANEL_MIN_MATCHES = 15
PANEL_MIN_SIMILARITY = 0.55  # normalised cross-correlation of the panel with the other photo
PANEL_MAX_AREA = 0.9  # share of the main photo the panel may cover
BESIDE_MIN_WHITE = 0.2  # share of white around the panel: a collage canvas, not a scene
BESIDE_MIN_CONTENT = 0.02  # share of the main photo with other content beside the panel

_sift = cv2.SIFT_create(nfeatures=4000)


def decode(data: bytes) -> np.ndarray:
    """A grayscale photo scaled down to WORK_SIZE."""
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("not an image")
    scale = WORK_SIZE / max(image.shape)
    if scale < 1:
        image = cv2.resize(image, (int(image.shape[1] * scale), int(image.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    return image


def _similarity(src: np.ndarray, dst: np.ndarray) -> tuple[np.ndarray | None, np.ndarray | None]:
    if len(src) < 12:
        return None, None
    return cv2.estimateAffinePartial2D(np.float32(src), np.float32(dst), method=cv2.RANSAC,
                                       ransacReprojThreshold=6, maxIters=5000, confidence=0.995)


def features(image: np.ndarray) -> tuple:
    """SIFT keypoints and descriptors of a photo."""
    return _sift.detectAndCompute(image, None)


def contains_itself(keypoints, descriptors) -> bool:
    """Does the photo (its features) contain a scaled copy of one of its own parts?"""
    if descriptors is None or len(keypoints) < 40:
        return False
    small, large = [], []
    for i, matches in enumerate(cv2.BFMatcher(cv2.NORM_L2).knnMatch(descriptors, descriptors, k=4)):
        others = [m for m in matches if m.trainIdx != i]
        if len(others) < 2 or others[0].distance > 0.75 * others[1].distance:
            continue  # no match, or not clearly better than the next one
        p, q = keypoints[i], keypoints[others[0].trainIdx]
        if np.hypot(p.pt[0] - q.pt[0], p.pt[1] - q.pt[1]) < 25 or q.size / p.size < 1.25:
            continue  # the same spot, or not a larger copy (each pair is kept once, small to large)
        small.append(p.pt)
        large.append(q.pt)
    transform, mask = _similarity(small, large)
    if transform is None:
        return False
    scale = float(np.hypot(transform[0, 0], transform[1, 0]))
    return int(mask.sum()) >= SELF_MIN_MATCHES and SELF_MIN_SCALE <= scale <= SELF_MAX_SCALE


def contains_panel(image: np.ndarray, kp_main, des_main, other: np.ndarray) -> bool:
    """Does `other` appear in the photo (`image` with its features) as a panel beside other
    content on a white canvas?"""
    kp_other, des_other = features(other)
    if des_main is None or des_other is None or len(kp_main) < 20 or len(kp_other) < 20:
        return False
    good = [m[0] for m in cv2.BFMatcher(cv2.NORM_L2).knnMatch(des_other, des_main, k=2)
            if len(m) == 2 and m[0].distance < 0.75 * m[1].distance]
    transform, mask = _similarity([kp_other[m.queryIdx].pt for m in good], [kp_main[m.trainIdx].pt for m in good])
    if transform is None or int(mask.sum()) < PANEL_MIN_MATCHES:
        return False
    size = (image.shape[1], image.shape[0])
    footprint = cv2.warpAffine(np.full_like(other, 255), transform, size, flags=cv2.INTER_NEAREST, borderValue=0) > 0
    if footprint.sum() < 500 or footprint.mean() > PANEL_MAX_AREA:
        return False
    warped = cv2.warpAffine(other, transform, size, flags=cv2.INTER_AREA, borderValue=0)
    a, b = warped[footprint].astype(np.float32), image[footprint].astype(np.float32)
    if float(((a - a.mean()) * (b - b.mean())).mean() / (a.std() * b.std() + 1e-6)) < PANEL_MIN_SIMILARITY:
        return False
    k = max(3, int(0.03 * max(image.shape)))
    beside = ~cv2.dilate(footprint.astype(np.uint8), np.ones((k, k), np.uint8)).astype(bool)
    white = image >= 235
    return bool(beside.any()) and float(white[beside].mean()) >= BESIDE_MIN_WHITE and \
        float((~white & beside).sum()) / image.size >= BESIDE_MIN_CONTENT


def is_collage(main: bytes, others: list[bytes]) -> bool:
    """Does the main photo show the product twice: a copy of itself, or another of the
    article's photos (`others`, the first two are enough) as a panel?"""
    image = decode(main)
    keypoints, descriptors = features(image)
    return contains_itself(keypoints, descriptors) or any(contains_panel(image, keypoints, descriptors, decode(o)) for o in others)
