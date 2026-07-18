import { describe, it, expect } from 'vitest';
import { createTimer, startTimer, pauseTimer, isRunning, elapsedMs, formatTime } from '../src/ui/timer';

describe('SolveTimer', () => {
  it('starts paused at its initial elapsed time', () => {
    const t = createTimer(5000);
    expect(isRunning(t)).toBe(false);
    expect(elapsedMs(t, 999_999)).toBe(5000);
  });

  it('accumulates while running and freezes on pause', () => {
    const t = createTimer();
    startTimer(t, 1000);
    expect(isRunning(t)).toBe(true);
    expect(elapsedMs(t, 4500)).toBe(3500);
    pauseTimer(t, 4500);
    expect(isRunning(t)).toBe(false);
    expect(elapsedMs(t, 99_000)).toBe(3500);
  });

  it('sums multiple run stretches', () => {
    const t = createTimer(1000);
    startTimer(t, 10_000);
    pauseTimer(t, 12_000); // +2000
    startTimer(t, 50_000);
    pauseTimer(t, 50_500); // +500
    expect(elapsedMs(t)).toBe(3500);
  });

  it('start while running and pause while paused are no-ops', () => {
    const t = createTimer();
    startTimer(t, 1000);
    startTimer(t, 9000); // must not reset runningSince
    expect(elapsedMs(t, 2000)).toBe(1000);
    pauseTimer(t, 2000);
    pauseTimer(t, 8000);
    expect(elapsedMs(t)).toBe(1000);
  });

  it('never goes backwards on a clock skew', () => {
    const t = createTimer();
    startTimer(t, 5000);
    expect(elapsedMs(t, 4000)).toBe(0);
    pauseTimer(t, 3000);
    expect(elapsedMs(t)).toBe(0);
  });

  describe('formatTime', () => {
    it('formats sub-hour times with tenths', () => {
      expect(formatTime(0)).toBe('0:00.0');
      expect(formatTime(222_600)).toBe('3:42.6');
      expect(formatTime(59_999)).toBe('0:59.9');
      expect(formatTime(600_000)).toBe('10:00.0');
    });

    it('formats hour-plus times as h:mm:ss', () => {
      expect(formatTime(3_600_000)).toBe('1:00:00');
      expect(formatTime(3_727_000)).toBe('1:02:07');
    });

    it('clamps negatives to zero', () => {
      expect(formatTime(-500)).toBe('0:00.0');
    });
  });
});
