// lib/features/counter/counterSlice.js
import { normalizeTrust } from '@/lib/trust/profile';
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  programList: [],
  selectedProgram: null,
  agentsList: [],
   closingGroupList: [],
    getAgentDataChange:false,
 getMemberDataChange:false,
 trustData:normalizeTrust({}),
 masterData:{ state: [], district: [], relation: [], caste: [], gotra: [] }
};

export const commonSlice = createSlice({
  name: 'data',
  initialState,
  reducers: {
    setPrograms: (state, action) => {
      state.programList = action.payload;
    },
    setSelectedProgram: (state, action) => {
      state.selectedProgram = action.payload;
    },
    setAgentList: (state, action) => {
      state.agentsList = action.payload;
    },
        setClosingGroups: (state, action) => {
      state.closingGroupList = action.payload;
    },
        setgetAgentDataChange(state,action){
      state.getAgentDataChange=action.payload
    },
    setgetMemberDataChange(state,action){
      state.getMemberDataChange=action.payload
    },
    setTrustData(state,action){
      state.trustData=action.payload
    },
    setMasterData(state,action){
      state.masterData=action.payload
    }
  },
});

// Action creators are generated for each case reducer function
export const { setPrograms,setSelectedProgram ,setAgentList,setgetAgentDataChange,setgetMemberDataChange,setTrustData,setClosingGroups,setMasterData} = commonSlice.actions;

export default commonSlice.reducer;