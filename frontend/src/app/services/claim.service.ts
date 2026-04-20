import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Claim } from '../interfaces/claim.interface';

const API = '/api';

@Injectable({ providedIn: 'root' })
export class ClaimService {
  private http = inject(HttpClient);

  createClaim(itemId: number, message: string): Observable<Claim> {
    return this.http.post<Claim>(`${API}/items/${itemId}/claims/`, { message });
  }

  getClaims(itemId: number): Observable<Claim[]> {
    return this.http.get<Claim[]>(`${API}/items/${itemId}/claims/list/`);
  }

  approveClaim(claimId: number): Observable<Claim> {
    return this.http.patch<Claim>(`${API}/claims/${claimId}/approve/`, {});
  }

  rejectClaim(claimId: number): Observable<Claim> {
    return this.http.patch<Claim>(`${API}/claims/${claimId}/reject/`, {});
  }
}
