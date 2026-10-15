"use client";
import { useRef, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { updateJob,addJob } from '@/redux/slices/Pdfjobslice';

const STEP_DURATIONS = [10, 20, 120, 60, 30]; // ~4 min total
const TOTAL_SECS     = STEP_DURATIONS.reduce((a, b) => a + b, 0);

export const usePdfGenerator = () => {
  const dispatch   = useDispatch();
  const timers     = useRef({});   // { [id]: intervalId }

  // ── Progress ticker ─────────────────────────────────────────────────────
  const startProgress = useCallback((id) => {
    // Clear any existing timer for this id (safety)
    if (timers.current[id]) clearInterval(timers.current[id]);

    const startTime = Date.now();
    let stepIdx     = 0;
    let stepElapsed = 0;

    timers.current[id] = setInterval(() => {
      stepElapsed += 0.5;
      const stepDur = STEP_DURATIONS[stepIdx] || 30;

      if (stepElapsed >= stepDur && stepIdx < STEP_DURATIONS.length - 1) {
        stepIdx    += 1;
        stepElapsed = 0;
      }

      const totalElapsed = (Date.now() - startTime) / 1000;
      const rawPct       = Math.min((totalElapsed / TOTAL_SECS) * 95, 95);

      dispatch(updateJob({
        id,
        patch: {
          progress:    Math.round(rawPct),
          elapsed:     Math.round(totalElapsed),
          currentStep: stepIdx,
        },
      }));
    }, 500);
  }, [dispatch]);

  const stopProgress = useCallback((id) => {
    if (timers.current[id]) {
      clearInterval(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  // ── generatePdf ──────────────────────────────────────────────────────────
  const generatePdf = useCallback(async ({
    label       = 'PDF Report',
    payload,
    apiEndpoint = '/api/rasid-generate',
  }) => {
    // ✅ ID yahan ek baar banta hai — slice aur hook dono isko use karte hain
    const id = `pdf_job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. Job Redux mein add karo (same id)
    dispatch(addJob({ id, label, payload, apiEndpoint }));

    // 2. Progress simulation shuru karo (same id)
    startProgress(id);

    try {
      const res = await fetch(apiEndpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      // 3. Timer band karo
      stopProgress(id);

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);

      // 4. ✅ Same id se done mark karo
      dispatch(updateJob({
        id,
        patch: { status: 'done', progress: 100, currentStep: 4, url },
      }));

      window.open(url, '_blank');

    } catch (err) {
      stopProgress(id);
      console.error('[PDF] error:', err);

      // 5. ✅ Same id se error mark karo
      dispatch(updateJob({
        id,
        patch: { status: 'error', error: err.message || 'Failed' },
      }));
    }

    return id;
  }, [startProgress, stopProgress, dispatch]);

  // ── retryJob ─────────────────────────────────────────────────────────────
  const retryJob = useCallback(async (job) => {
    if (!job) return;

    // Reset existing job (same id, don't create new)
    dispatch(updateJob({
      id:    job.id,
      patch: { status: 'loading', progress: 0, elapsed: 0, currentStep: 0, error: null, url: null },
    }));

    startProgress(job.id);

    try {
      const res = await fetch(job.apiEndpoint || '/api/rasid-generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(job.payload),
      });

      stopProgress(job.id);

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);

      dispatch(updateJob({
        id:    job.id,
        patch: { status: 'done', progress: 100, currentStep: 4, url },
      }));

      window.open(url, '_blank');

    } catch (err) {
      stopProgress(job.id);
      dispatch(updateJob({
        id:    job.id,
        patch: { status: 'error', error: err.message || 'Failed' },
      }));
    }
  }, [startProgress, stopProgress, dispatch]);

  return { generatePdf, retryJob };
};