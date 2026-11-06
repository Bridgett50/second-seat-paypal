import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { GlimmerClient } from "@second-seat/bot/dist/src/private/redact.js";
import { MuseClient } from "@second-seat/bot/dist/src/brief/muse.js";
import { createCandidateRuntime } from "../src/candidateRuntime.js";
import type { LiveAnalysisConfig } from "../src/liveConfig.js";
const baseEnv: Readonly<Record<string,string|undefined>>={SECOND_SEAT_MODE:"live",SECOND_SEAT_CANDIDATE_REASONER:"1",SECOND_SEAT_TEST_MODE:"0",META_API_KEY:"synthetic-not-a-secret"};
function analysis(mode: LiveAnalysisConfig["mode"]): LiveAnalysisConfig {
  return {mode,gate:createPrivacyGate({mode:"fixture"}),redactor:new GlimmerClient("http://127.0.0.1:9"),analyzer:new MuseClient(),analyzerLabel:"test-only"};
}
describe("meeting-room-candidate-runtime",()=>{
  it("returns undefined when reasoner flag off",()=>{
    const spy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network disabled"));
    try{const r=createCandidateRuntime({...baseEnv,SECOND_SEAT_CANDIDATE_REASONER:"0"},analysis("live"));expect(r).toBeUndefined();expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
  });
  it("returns undefined when mode offline",()=>{
    const spy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network disabled"));
    try{const r=createCandidateRuntime({...baseEnv,SECOND_SEAT_MODE:"offline"},analysis("live"));expect(r).toBeUndefined();expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
  });
  it("returns undefined when test flag on",()=>{
    const spy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network disabled"));
    try{const r=createCandidateRuntime({...baseEnv,SECOND_SEAT_TEST_MODE:"1"},analysis("live"));expect(r).toBeUndefined();expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
  });
  it("returns undefined when analysis offline",()=>{
    const spy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network disabled"));
    try{const r=createCandidateRuntime(baseEnv,{mode:'offline'});expect(r).toBeUndefined();expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
  });
  it("enabled factory returns runtime with zero sizes and 404 read",()=>{
    const spy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network disabled"));
    try{const rt=createCandidateRuntime(baseEnv,analysis("live"));if(rt===undefined)throw new Error("expected runtime");expect(rt.meetingRoom.sizes().pages).toBe(0);expect(rt.meetingRoom.sizes().stores).toBe(0);expect(rt.candidateApprovalApi.read(null,"unknown").status).toBe(404);expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
  });
  it("demo ingest preserves zero-provider behavior",()=>{
    const cfg=analysis("live");
    const prepareSpy=vi.spyOn(cfg.gate,"prepare");
    const fetchSpy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network disabled"));
    try{
      const rt=createCandidateRuntime(baseEnv,cfg);
      if(rt===undefined) throw new Error("expected runtime");
      const key=randomUUID();
      const opened=rt.meetingRoom.open("?demo=1",{host:"127.0.0.1"},key);
      expect(opened.demo).toBeTruthy();
      const res=rt.meetingRoom.ingestConversationAs(key,opened.roomId,{version:1,meetingId:opened.view.selectedMeetingId,utteranceId:"synthetic-u1",sequence:1,revision:1,speaker:"Synthetic",text:"made-up"});
      expect(res.status).toBe(200);
      expect(prepareSpy).toHaveBeenCalledTimes(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(rt.candidateApprovalApi.read(key,opened.roomId).status).toBe(404);
    }finally{
      prepareSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });
  it("missing key throws generic and no fetch",()=>{
    const spy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network disabled"));
    try{expect(()=>createCandidateRuntime({...baseEnv,META_API_KEY:""},analysis("live"))).toThrow(/META_API_KEY|MUSE_API_KEY/);try{createCandidateRuntime({...baseEnv,META_API_KEY:""},analysis("live"));}catch(e){expect(String(e)).not.toContain("synthetic-not-a-secret");}expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
  });
});
