import math
def Phi(x): return 0.5*(1+math.erf(x/math.sqrt(2)))
def Eabs(mu,s):
    # E|X| for X~N(mu,s^2): s*sqrt(2/pi)*exp(-mu^2/(2 s^2)) + mu*(2Phi(mu/s)-1)
    return s*math.sqrt(2/math.pi)*math.exp(-mu**2/(2*s*s)) + mu*(2*Phi(mu/s)-1)
def note(mu,s):
    return math.sqrt(2*s*s/math.pi)*math.exp(-mu**2/(s*s)) + mu*(2*Phi(mu/s)-1)
for mu,s in [(0.3,2.0),(-1.2,0.7),(0.0,1.0),(1.0,1.0)]:
    t=Eabs(mu,s); n=note(mu,s)
    print(f"mu={mu:>5} sigma={s:>4}  true={t:.8f}  note={n:.8f}  diff={n-t:+.6f}")
