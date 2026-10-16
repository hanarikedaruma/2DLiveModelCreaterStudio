"""Producer-paced reserve simulations: slow synthesis, fast short speech and long staging."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from speech_buffering import SpeechBufferPlan

class BufferTests(unittest.TestCase):
    def simulate(self,total,rtf,adaptive=True,estimate_ratio=1.):
        # One 640 ms chunk at each producer deadline; 10 ms output callbacks.
        plan=SpeechBufferPlan('あ'*round(total/.25),.25*estimate_ratio)
        ready=0.;position=0.;started=None;rebuffers=0;priming=True;next_chunk=.64*rtf
        generated=0.;t=0.
        while position<total-1e-6 and t<total*rtf+total+3:
            if t+1e-6>=next_chunk and generated<total:
                chunk=min(.64,total-generated);generated+=chunk;ready+=chunk
                plan.observe(round(chunk*48000),next_chunk)
                next_chunk+=.64*rtf
            ended=generated>=total-1e-6
            if priming and (ended or ready>=1 and (started is not None or not adaptive or plan.ready())):
                priming=False
                if started is None:started=t
            if not priming:
                take=min(.01,ready);ready-=take;position+=take
                if take<.01-1e-6 and not ended:rebuffers+=1;priming=True
            t+=.01
        self.assertAlmostEqual(position,total,places=4)
        return rebuffers,started,plan

    def test_slow_long_utterance_no_longer_runs_out_mid_sentence(self):
        before,_,_=self.simulate(16.,1.6,False)
        after,start,plan=self.simulate(16.,1.6)
        self.assertGreater(before,0);self.assertEqual(after,0)
        self.assertLess(start,16.*1.6);self.assertGreater(plan.target,48000)

    def test_short_fast_utterance_starts_with_two_chunks(self):
        rebuffers,start,_=self.simulate(3.2,.85)
        self.assertEqual(rebuffers,0);self.assertLess(start,1.2)

    def test_reserve_can_exceed_ring_without_waiting_for_ring_capacity(self):
        rebuffers,start,plan=self.simulate(50.,2.2)
        self.assertEqual(rebuffers,0);self.assertGreater(plan.target,8*48000)
        self.assertLess(start,110.)

    def test_short_final_partial_chunk_with_underestimated_duration_keeps_its_tail(self):
        before,_,_=self.simulate(3.36,1.33,False,estimate_ratio=.83)
        after,_,_=self.simulate(3.36,1.33,True,estimate_ratio=.83)
        self.assertGreater(before,0);self.assertEqual(after,0)

    def test_cold_prefill_and_host_receive_delays_do_not_inflate_producer_ratio(self):
        plan=SpeechBufferPlan('こんにちは')
        plan.observe(30460,100.);plan.observe(30720,100.64)
        self.assertAlmostEqual(plan.rtf,1.10)
        plan.observe(260,None);self.assertAlmostEqual(plan.rtf,1.10)
        plan.observe(0,float('nan'));self.assertAlmostEqual(plan.rtf,1.10)

if __name__=='__main__':unittest.main()
