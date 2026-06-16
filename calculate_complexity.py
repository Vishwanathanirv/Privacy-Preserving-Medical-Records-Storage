import numpy as np

def calculate_complexity(img, i, j):
    v1 = abs(img[i, j - 1] - img[i - 1, j])
    v2 = abs(img[i - 1, j] - img[i, j + 1])
    v3 = abs(img[i, j + 1] - img[i + 1, j])
    v4 = abs(img[i + 1, j] - img[i, j - 1])
    complexity = (v1 + v2 + v3 + v4) / 4.0
    return complexity
