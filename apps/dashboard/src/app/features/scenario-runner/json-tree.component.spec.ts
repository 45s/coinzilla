import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { JsonTreeComponent } from './json-tree.component';

describe('JsonTreeComponent', () => {
  it('shows nested objects and keeps false, null and empty string values distinct', () => {
    TestBed.configureTestingModule({ imports: [JsonTreeComponent] });
    const fixture = TestBed.createComponent(JsonTreeComponent);
    fixture.componentRef.setInput('label', 'payload');
    fixture.componentRef.setInput('value', {
      enabled: false,
      absent: null,
      empty: '',
      nested: { count: 0 },
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text, 'false must be displayed as a real value').toContain('false');
    expect(text, 'null must be displayed rather than treated as missing').toContain('null');
    expect(text, 'empty strings must remain visible').toContain('""');
    expect(text, 'nested values must be represented by recursive tree nodes').toContain('count');
    expect(fixture.nativeElement.querySelectorAll('app-json-tree').length).toBeGreaterThan(0);
  });

  it('preserves array element order and exposes copy controls for individual values', () => {
    TestBed.configureTestingModule({ imports: [JsonTreeComponent] });
    const fixture = TestBed.createComponent(JsonTreeComponent);
    fixture.componentRef.setInput('value', ['first', 'second']);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text.indexOf('first'), 'the first array element must precede the second').toBeLessThan(text.indexOf('second'));
    expect(fixture.nativeElement.querySelectorAll('button').length).toBeGreaterThan(0);
  });
});
