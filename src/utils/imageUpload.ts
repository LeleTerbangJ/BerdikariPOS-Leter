import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * Compress an image file to a max dimension and quality,
 * returning a lightweight base64 Data URL (~15-30KB).
 */
export function compressImage(
  file: File,
  maxWidth = 400,
  maxHeight = 400,
  quality = 0.75
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Gagal memuat gambar'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Compress and optionally upload menu image to Supabase Storage bucket 'menu-images'.
 * Falls back gracefully to compressed base64 if Supabase Storage is not set up.
 */
export async function processAndUploadMenuImage(file: File): Promise<string> {
  // Step 1: Compress image locally (reduces size from 2MB+ down to ~20KB)
  const compressedBase64 = await compressImage(file, 400, 400, 0.75);

  if (!isSupabaseConfigured) {
    return compressedBase64;
  }

  try {
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `menu-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

    const res = await fetch(compressedBase64);
    const blob = await res.blob();

    const { data, error } = await supabase.storage
      .from('menu-images')
      .upload(fileName, blob, {
        contentType: blob.type || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.warn('[ImageUpload] Supabase Storage bucket upload failed, using compressed base64 fallback:', error.message);
      return compressedBase64;
    }

    const { data: publicUrlData } = supabase.storage
      .from('menu-images')
      .getPublicUrl(data.path);

    if (publicUrlData?.publicUrl) {
      return publicUrlData.publicUrl;
    }

    return compressedBase64;
  } catch (err) {
    console.warn('[ImageUpload] Exception uploading to Supabase Storage, using compressed base64 fallback:', err);
    return compressedBase64;
  }
}
