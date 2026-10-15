import { createSlice } from '@reduxjs/toolkit';

const pdfJobSlice = createSlice({
  name: 'pdfJobs',
  initialState: {
    jobs: [],
  },
  reducers: {
    // ID hook se generate hoke payload mein aata hai
    addJob: (state, action) => {
      const { id, label, payload, apiEndpoint } = action.payload;
      state.jobs.push({
        id,
        label,
        status:      'loading',
        progress:    0,
        elapsed:     0,
        currentStep: 0,
        error:       null,
        url:         null,
        payload,
        apiEndpoint: apiEndpoint || '/api/rasid-generate',
      });
    },

    updateJob: (state, action) => {
      const { id, patch } = action.payload;
      const job = state.jobs.find((j) => j.id === id);
      if (job) Object.assign(job, patch);
    },

    removeJob: (state, action) => {
      state.jobs = state.jobs.filter((j) => j.id !== action.payload);
    },

    clearDone: (state) => {
      state.jobs = state.jobs.filter((j) => j.status === 'loading');
    },
  },
});

export const { addJob, updateJob, removeJob, clearDone } = pdfJobSlice.actions;
export default pdfJobSlice.reducer;