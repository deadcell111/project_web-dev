import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ItemService } from '../../services/item.service';
import { CategoryService } from '../../services/category.service';
import { Item } from '../../interfaces/item.interface';
import { Category } from '../../interfaces/category.interface';
import { ImageUpload } from '../../components/image-upload/image-upload';

@Component({
  selector: 'app-item-edit',
  standalone: true,
  imports: [FormsModule, RouterLink, ImageUpload],
  template: `
    <div class="max-w-xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">Edit item</h1>
      @if (error()) { <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{{ error() }}</div> }
      @if (item) {
        <div class="space-y-4 bg-white rounded-lg border border-gray-200 p-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input [(ngModel)]="item.title" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea [(ngModel)]="item.description" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select [(ngModel)]="item.category" class="w-full px-3 py-2 border border-gray-300 rounded-md">
              @for (cat of categories; track cat.id) {
                <option [ngValue]="cat.id">{{ cat.icon }} {{ cat.name }}</option>
              }
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input [(ngModel)]="item.location" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Photo</label>
            <app-image-upload kind="item" [existingUrl]="item.image" (uploaded)="imageKey = $event"></app-image-upload>
          </div>
          <div class="pt-2">
            <button (click)="save()" [disabled]="saving()" class="px-4 py-2 bg-gray-900 text-white rounded-md disabled:opacity-50">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
            <a [routerLink]="['/items', item.id]" class="ml-3 text-sm text-gray-600">Cancel</a>
          </div>
        </div>
      }
    </div>
  `,
})
export class ItemEdit implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private itemService = inject(ItemService);
  private categoryService = inject(CategoryService);

  item: Item | null = null;
  categories: Category[] = [];
  imageKey: string | null = null;
  saving = signal(false);
  error = signal<string | null>(null);

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.categoryService.getCategories().subscribe(cs => this.categories = cs);
    this.itemService.getItem(id).subscribe(item => {
      this.item = item;
      this.imageKey = item.image_key;
    });
  }

  save() {
    if (!this.item) return;
    this.saving.set(true);
    this.itemService.updateItem(this.item.id, {
      title: this.item.title,
      description: this.item.description,
      item_type: this.item.item_type,
      category: this.item.category,
      location: this.item.location,
      image: this.imageKey,
    }).subscribe({
      next: () => { this.saving.set(false); this.router.navigate(['/items', this.item!.id]); },
      error: err => { this.saving.set(false); this.error.set(err.error?.detail || 'Save failed.'); },
    });
  }
}
