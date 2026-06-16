import numpy as np

def num2bitlist(dec_number, bit_num):
    bin_str = format(dec_number, '0{}b'.format(bit_num))  # binary string with padding
    double_bitlist = np.array([int(b) for b in bin_str], dtype=int)
    return double_bitlist
