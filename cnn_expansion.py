import numpy as np

def cnn_expansion(img, predicted_image, watermark, odd_or_even_num,
                  arithenco, num2bitlist):
    img = img.astype(float)
    M, N = img.shape
    mn = int(np.ceil(np.log2(M * N)))
    imgW = img.copy()
    watermark_length = len(watermark)

    odd_or_even_place = np.zeros((M, N))
    location_map = np.zeros((M, N))

    for i in range(1, M - 1):
        for j in range(1, N - 1):
            if (i + j) % 2 == odd_or_even_num:
                odd_or_even_place[i, j] = 1

    inserable_place = np.argwhere(odd_or_even_place == 1)
    idx = np.ravel_multi_index((inserable_place[:, 0], inserable_place[:, 1]), (M, N))

    minimum_lsb_length = watermark_length + 4 * mn
    current_length = minimum_lsb_length
    start_place = 0
    end_place = current_length

    while True:
        for k in range(start_place, end_place):
            i = idx[k] % M
            j = idx[k] // M
            x = imgW[i, j]
            x_predict = predicted_image[i, j]
            value = 2 * x - x_predict
            if value > 254 or value < 0:
                location_map[i, j] = 1

        number1 = np.sum(location_map)
        number0 = M * N - number1
        if number1 == 0:
            compressed_location_map_bitlist = np.array([0])
            number0 = 0
        else:
            compressed_location_map_bitlist = arithenco(location_map.flatten() + 1,
                                                        [number0, number1])

        if current_length - minimum_lsb_length < len(compressed_location_map_bitlist) + 4 * mn:
            current_length += 1000
            start_place = end_place
            end_place = current_length
        else:
            break

    extracted_lsb_bitlist = []
    for k in range(len(idx) - 1,
                   len(idx) - (len(compressed_location_map_bitlist) + 4 * mn),
                   -1):
        pos = np.unravel_index(idx[k], (M, N))
        extracted_lsb_bitlist.append(int(imgW[pos]) & 1)

    length_compressed_location_map_bitlist = num2bitlist(len(compressed_location_map_bitlist), mn)
    whole_compressed_location_map_bitlist = np.concatenate([
        length_compressed_location_map_bitlist,
        compressed_location_map_bitlist
    ])

    message_to_embed = np.concatenate([extracted_lsb_bitlist, watermark])
    message_to_embed_length = num2bitlist(len(message_to_embed), mn)

    number1_bitlist = num2bitlist(int(number1), mn)
    number0_bitlist = num2bitlist(int(number0), mn)

    lsb_to_replace_bitlist = np.concatenate([
        whole_compressed_location_map_bitlist,
        message_to_embed_length,
        number1_bitlist,
        number0_bitlist
    ])

    for bit_idx, k in enumerate(range(len(idx) - 1,
                                      len(idx) - len(lsb_to_replace_bitlist) - 1,
                                      -1)):
        pos = np.unravel_index(idx[k], (M, N))
        imgW[pos] = imgW[pos] - (int(imgW[pos]) & 1) + lsb_to_replace_bitlist[bit_idx]

    index_message = 0
    for k in range(len(idx)):
        pos = np.unravel_index(idx[k], (M, N))
        i, j = pos
        if location_map[i, j] == 0:
            x = imgW[i, j]
            x_predict = predicted_image[i, j]
            dij = x - x_predict
            if message_to_embed[index_message] == 1:
                Dij = 2 * dij + 1
            else:
                Dij = 2 * dij
            imgW[i, j] = Dij + x_predict
            index_message += 1
            if index_message >= len(message_to_embed):
                break

    return imgW
