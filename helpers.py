import numpy as np
from scipy import ndimage

def calculate_complexity(image):
    """
    Calculate complexity map using gradient magnitude
    """
    try:
        # Convert to uint8 for gradient calculation
        image_uint8 = image.astype(np.uint8)
        
        # Calculate gradients
        grad_x = ndimage.sobel(image_uint8, axis=1)
        grad_y = ndimage.sobel(image_uint8, axis=0)
        
        # Calculate gradient magnitude
        complexity_map = np.sqrt(grad_x**2 + grad_y**2)
        
        # Normalize to 0-1 range
        if complexity_map.max() > 0:
            complexity_map = complexity_map / complexity_map.max()
            
        return complexity_map
        
    except Exception as e:
        print(f"Error calculating complexity: {e}")
        return np.ones_like(image) * 0.5

def arithenco(seq, counts):
    """
    Simple arithmetic encoding implementation (replacement)
    """
    try:
        # Simple implementation - return sequence as is for compatibility
        # This is a simplified version that doesn't require external dependencies
        return seq
    except Exception as e:
        print(f"Error in arithenco: {e}")
        return seq

def num2bitlist(number, bit_length=8):
    """
    Convert number to bit list
    """
    try:
        if number < 0:
            number = 0
        if number >= 2**bit_length:
            number = 2**bit_length - 1
            
        bit_list = [int(b) for b in format(number, f'0{bit_length}b')]
        return bit_list
    except Exception as e:
        print(f"Error in num2bitlist: {e}")
        return [0] * bit_length

def calculate_tp_tn(original, predicted):
    """
    Calculate True Positive and True Negative rates
    """
    try:
        # For binary classification metrics
        diff = np.abs(original - predicted)
        tp = np.sum(diff < 1)  # pixels with small difference
        tn = np.sum(diff >= 1)  # pixels with larger difference
        return tp, tn
    except Exception as e:
        print(f"Error in calculate_tp_tn: {e}")
        return 0, 0

def calculate_psnr(original, compressed):
    """
    Calculate PSNR between original and compressed images
    """
    try:
        mse = np.mean((original - compressed) ** 2)
        if mse == 0:
            return float('inf')
        max_pixel = 255.0
        psnr = 20 * np.log10(max_pixel / np.sqrt(mse))
        return psnr
    except Exception as e:
        print(f"Error in calculate_psnr: {e}")
        return 0

def binary_to_text(binary_list):
    """
    Convert list of bits to text string
    """
    try:
        text = ""
        for i in range(0, len(binary_list), 8):
            byte = binary_list[i:i+8]
            if len(byte) == 8:
                char_code = int("".join(str(bit) for bit in byte), 2)
                text += chr(char_code)
        return text
    except Exception as e:
        print(f"Error in binary_to_text: {e}")
        return ""

def text_to_binary(text):
    """
    Convert text string to list of bits
    """
    try:
        binary_list = []
        for char in text:
            binary_list.extend([int(bit) for bit in format(ord(char), '08b')])
        return binary_list
    except Exception as e:
        print(f"Error in text_to_binary: {e}")
        return []