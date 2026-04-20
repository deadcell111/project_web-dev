import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Stats {
  total_items: number;
  open_items: number;
  resolved_items: number;
  lost_active: number;
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private http = inject(HttpClient);

  getStats(): Observable<Stats> {
    return this.http.get<Stats>('/api/stats/');
  }
}
