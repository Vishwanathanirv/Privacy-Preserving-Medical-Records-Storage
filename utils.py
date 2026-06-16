import cv2
import torch
import numpy as np
from torchvision import transforms
from model.predict_model import PredictModel
from cnn_histogram_shifting import cnn_histogram_shifting as cnn_histogram_shifting_py
from cnn_expansion import cnn_expansion as cnn_expansion_py
from helpers import calculate_complexity, arithenco, num2bitlist, calculate_tp_tn  # helper functions


def load_model(file_name, model: PredictModel):
    """Load a PyTorch model from a checkpoint."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    checkpoint = torch.load(file_name, map_location=device)

    if isinstance(checkpoint, dict) and 'network' in checkpoint:
        model.model.load_state_dict(checkpoint['network'])
    else:
        model.model.load_state_dict(checkpoint)

    model.model.to(device)
    model.model.eval()
    print(f"Model loaded on {device}.")


def parse_sample(img_gray, num=0):
    """
    Prepares input for CNN by selecting pixels based on odd/even positions.
    Rotates if num==1 for the second half of message embedding.
    """
    source = np.zeros(img_gray.shape)
    for i in range(1, img_gray.shape[0] - 1):
        for j in range(1, img_gray.shape[1] - 1):
            if (i + j) % 2 == num:
                source[i - 1, j] = img_gray[i - 1, j]
                source[i + 1, j] = img_gray[i + 1, j]
                source[i, j - 1] = img_gray[i, j - 1]
                source[i, j + 1] = img_gray[i, j + 1]

    if num == 1:
        source = cv2.rotate(source, rotateCode=cv2.ROTATE_90_CLOCKWISE)

    source = np.expand_dims(source, axis=2)
    return source


def cnn_histogram_shifting(img_gray, message_to_embed, device, model):
    """
    Apply CNN-based histogram shifting embedding for watermark.
    Splits message into two halves and processes odd/even pixels separately.
    """
    half_message = len(message_to_embed) // 2

    for i in range(2):
        num = i
        message_to_embed_half = message_to_embed[i * half_message:(i + 1) * half_message]

        # Prepare input
        input_image = parse_sample(img_gray, num=num)
        input_image = transforms.ToTensor()(input_image).unsqueeze(1).float().to(device)

        # Predict image with CNN
        predicted_image = model.test_on_batch(input_image)
        predicted_image = predicted_image.squeeze(1).squeeze(0).cpu().numpy()
        predicted_image = np.around(predicted_image)

        if num == 1:
            predicted_image = cv2.rotate(predicted_image, rotateCode=cv2.ROTATE_90_COUNTERCLOCKWISE)

        predicted_image_new = np.zeros(img_gray.shape)
        predicted_image_new[1:-1, 1:-1] = predicted_image

        # Call Python version of histogram shifting
        img_gray = cnn_histogram_shifting_py(
            img_gray,
            predicted_image_new,
            message_to_embed_half,
            num,
            calculate_complexity,
            arithenco,
            num2bitlist,
            calculate_tp_tn
        )

    return img_gray


def cnn_expansion(img_gray, message_to_embed, device, model):
    """
    Apply CNN-based expansion embedding for watermark.
    Splits message into two halves and processes odd/even pixels separately.
    """
    half_message = len(message_to_embed) // 2

    for i in range(2):
        num = i
        message_to_embed_half = message_to_embed[i * half_message:(i + 1) * half_message]

        # Prepare input
        input_image = parse_sample(img_gray, num=num)
        input_image = transforms.ToTensor()(input_image).unsqueeze(1).float().to(device)

        # Predict image with CNN
        predicted_image = model.test_on_batch(input_image)
        predicted_image = predicted_image.squeeze(1).squeeze(0).cpu().numpy()
        predicted_image = np.around(predicted_image)

        if num == 1:
            predicted_image = cv2.rotate(predicted_image, rotateCode=cv2.ROTATE_90_COUNTERCLOCKWISE)

        predicted_image_new = np.zeros(img_gray.shape)
        predicted_image_new[1:-1, 1:-1] = predicted_image

        # Call Python version of expansion embedding
        img_gray = cnn_expansion_py(
            img_gray,
            predicted_image_new,
            message_to_embed_half,
            num,
            calculate_complexity,
            arithenco,
            num2bitlist,
            calculate_tp_tn
        )

    return img_gray
