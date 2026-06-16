import numpy as np

def calculate_tp_tn(predicted_error, length_message):
    unique_vals, counts = np.unique(predicted_error, return_counts=True)
    error_hist_info = np.column_stack((unique_vals, counts))

    temp_sum = 0
    place_index = []

    while temp_sum < length_message and len(error_hist_info) > 0:
        idx = np.argmax(error_hist_info[:, 1])
        temp = error_hist_info[idx, 1]
        temp_sum += temp
        place_index.append(error_hist_info[idx, 0])
        error_hist_info = np.delete(error_hist_info, idx, axis=0)

    Tp = max(place_index)
    Tn = min(place_index)

    return Tp, Tn
