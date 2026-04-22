import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { Category } from '../interfaces/category.interface';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private http = inject(HttpClient);
  private cache$?: Observable<Category[]>;

  getCategories(): Observable<Category[]> {
    if (!this.cache$) {
      this.cache$ = this.http.get<Category[]>('/api/categories/').pipe(
        shareReplay(1)
      );
    }
    return this.cache$;
  }

  refresh(): Observable<Category[]> {
    this.cache$ = this.http.get<Category[]>('/api/categories/').pipe(
      shareReplay(1)
    );
    return this.cache$;
  }
}
