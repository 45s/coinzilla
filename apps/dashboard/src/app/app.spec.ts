import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AppComponent } from './app';

describe('AppComponent', () => {
  it('renders the Coinzilla dashboard shell and its overview feature', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const renderedText = fixture.nativeElement.textContent as string;

    expect(renderedText).toContain('coinzilla');
    expect(renderedText).toContain('Overview');
    expect(renderedText).toContain('Backend disconnected');
    expect(renderedText).toContain('Portfolio performance');
  });
});
