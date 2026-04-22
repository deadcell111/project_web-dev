import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { UploadService } from '../../services/upload.service';

@Component({
  selector: 'app-image-upload',
  standalone: true,
  template: `
    <div class="flex items-center gap-4">
      @if (previewUrl || existingUrl) {
        <img [src]="previewUrl || existingUrl" class="w-20 h-20 rounded-md object-cover border border-gray-200" />
      } @else {
        <div class="w-20 h-20 rounded-md bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No image</div>
      }
      <label class="inline-flex items-center px-3 py-2 rounded-md bg-gray-900 text-white text-sm cursor-pointer hover:bg-gray-800">
        <input type="file" accept="image/jpeg,image/png,image/webp" (change)="onFile($event)" class="hidden" />
        {{ uploading() ? 'Uploading…' : 'Choose image' }}
      </label>
      @if (error()) { <span class="text-red-600 text-sm">{{ error() }}</span> }
    </div>
  `,
})
export class ImageUpload {
  @Input() kind: 'item' | 'avatar' = 'item';
  @Input() existingUrl: string | null = null;
  @Output() uploaded = new EventEmitter<string>(); // emits object_key

  private uploads = inject(UploadService);
  uploading = signal(false);
  error = signal<string | null>(null);
  previewUrl: string | null = null;

  onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.error.set('Only JPG / PNG / WebP allowed.');
      return;
    }
    this.error.set(null);
    this.previewUrl = URL.createObjectURL(file);
    this.uploading.set(true);
    this.uploads.upload(file, this.kind).subscribe({
      next: key => {
        this.uploading.set(false);
        this.uploaded.emit(key);
      },
      error: () => {
        this.uploading.set(false);
        this.error.set('Upload failed. Try again.');
      },
    });
  }
}
