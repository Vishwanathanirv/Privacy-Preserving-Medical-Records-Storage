import torch
from model.cnnp import CNNP

class PredictModel:
    def __init__(self, device):
        self.device = device
        self.model = CNNP().to(device)

    def test_on_batch(self, input_image):
        self.model.eval()
        with torch.no_grad():
            # Ensure input has correct shape [batch, channels, height, width]
            if len(input_image.shape) == 2:
                input_image = input_image.unsqueeze(0).unsqueeze(0)  # [1, 1, H, W]
            elif len(input_image.shape) == 3:
                if input_image.shape[0] == 1:  # [1, H, W]
                    input_image = input_image.unsqueeze(0)  # [1, 1, H, W]
                else:  # [H, W, C] or [C, H, W]
                    input_image = input_image.unsqueeze(0)  # [1, C, H, W]
                    
            input_image = input_image.to(self.device)
            predicted_image = self.model(input_image)
            return predicted_image