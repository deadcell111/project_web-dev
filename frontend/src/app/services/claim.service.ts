import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Claim, MyClaim } from '../interfaces/claim.interface';

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

  withdraw(claimId: number): Observable<void> {
    return this.http.delete<void>(`/api/claims/${claimId}/withdraw/`);
  }

  myClaims(): Observable<MyClaim[]> {
    return this.http.get<MyClaim[]>('/api/claims/my/');
  }
}
