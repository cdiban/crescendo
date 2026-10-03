import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useAutoRefresh } from './useAutoRefresh.ts';

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

function Probe({ onRefresh, ms = 60_000 }: { onRefresh: () => void; ms?: number }) {
  useAutoRefresh(onRefresh, ms);
  return null;
}

describe('useAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });
  afterEach(() => vi.useRealTimers());

  it('refresca cada 60 s mientras la pestaña está visible (no al montar)', () => {
    const onRefresh = vi.fn();
    render(<Probe onRefresh={onRefresh} />);
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(60_000));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('no refresca con la pestaña oculta y al volver refresca de inmediato si ya venció el intervalo', () => {
    const onRefresh = vi.fn();
    render(<Probe onRefresh={onRefresh} />);

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(180_000));
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => setVisibility('visible'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(59_000));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('al volver antes de que venza el intervalo no refresca de más', () => {
    const onRefresh = vi.fn();
    render(<Probe onRefresh={onRefresh} />);
    act(() => vi.advanceTimersByTime(20_000));
    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => setVisibility('visible'));
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30_000));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('deja de refrescar al desmontar', () => {
    const onRefresh = vi.fn();
    const { unmount } = render(<Probe onRefresh={onRefresh} />);
    unmount();
    act(() => vi.advanceTimersByTime(120_000));
    act(() => setVisibility('visible'));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('usa siempre el callback más reciente', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe onRefresh={first} />);
    rerender(<Probe onRefresh={second} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
