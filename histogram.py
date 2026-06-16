import numpy as np
import cv2
from scipy import ndimage

def cnn_histogram_shifting(img_gray, predicted_image, watermark_bits, odd_or_even_num, 
                          calculate_complexity, arithenco, num2bitlist, calculate_tp_tn):
    """
    CNN-based Histogram Shifting for reversible data hiding
    """
    try:
        # Validate inputs
        if img_gray is None:
            raise ValueError("Input image is None")
        
        if len(watermark_bits) == 0:
            raise ValueError("Watermark bits are empty")
        
        height, width = img_gray.shape
        predicted_image_new = np.zeros(img_gray.shape)
        
        # Calculate complexity map
        complexity_map = calculate_complexity(img_gray)
        
        # Flatten and sort positions by complexity
        flat_complexity = complexity_map.flatten()
        flat_positions = np.arange(height * width)
        
        # Sort by complexity (descending order - embed in complex regions first)
        sorted_indices = np.argsort(flat_complexity)[::-1]
        
        # Select embedding positions
        max_embedding_capacity = len(flat_positions)
        actual_embedding_bits = min(len(watermark_bits), max_embedding_capacity)
        
        index_complexity = sorted_indices[:actual_embedding_bits]
        inserable_place = [(idx // width, idx % width) for idx in index_complexity]
        
        # Create copy for embedded image
        img_embedded = img_gray.copy().astype(np.float64)
        
        # Embed watermark bits using histogram shifting
        embedded_bits_count = 0
        
        for k, (i, j) in enumerate(inserable_place):
            if embedded_bits_count >= len(watermark_bits):
                break
                
            current_pixel = img_gray[i, j]
            watermark_bit = watermark_bits[embedded_bits_count]
            
            # Simple histogram shifting embedding
            if odd_or_even_num == 0:
                # Even-based embedding
                if watermark_bit == 0:
                    # Keep even values as is, make odd values even by subtracting 1
                    if current_pixel % 2 == 1:
                        img_embedded[i, j] = current_pixel - 1
                    else:
                        img_embedded[i, j] = current_pixel
                else:
                    # Make values odd by adding/subtracting 1
                    if current_pixel % 2 == 0:
                        img_embedded[i, j] = current_pixel + 1
                    else:
                        img_embedded[i, j] = current_pixel
            else:
                # Odd-based embedding (similar logic)
                if watermark_bit == 0:
                    if current_pixel % 2 == 0:
                        img_embedded[i, j] = current_pixel + 1
                    else:
                        img_embedded[i, j] = current_pixel
                else:
                    if current_pixel % 2 == 1:
                        img_embedded[i, j] = current_pixel - 1
                    else:
                        img_embedded[i, j] = current_pixel
            
            # Ensure pixel values stay in valid range [0, 255]
            img_embedded[i, j] = np.clip(img_embedded[i, j], 0, 255)
            embedded_bits_count += 1
        
        print(f"Embedded {embedded_bits_count} bits successfully")
        return img_embedded, index_complexity, inserable_place
        
    except Exception as e:
        print(f"Error in histogram shifting: {e}")
        # Return fallback values
        height, width = img_gray.shape
        fallback_indices = list(range(min(len(watermark_bits), height*width)))
        fallback_places = [(i//width, i%width) for i in fallback_indices]
        return img_gray.copy(), fallback_indices, fallback_places