// lib/store.js
import { configureStore } from '@reduxjs/toolkit';
import commonReducer from './slices/commonSlice'; // Assuming you create a counter slice below
import pdfJobReducer from './slices/Pdfjobslice'; // Import the PDF job slice reducer

export const makeStore = () => {
  return configureStore({
    reducer: {
      // Add your reducers here
      data: commonReducer,
       pdfJobs: pdfJobReducer,
    },
  });
};