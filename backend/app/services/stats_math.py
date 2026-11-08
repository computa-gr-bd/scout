"""Matemática estatística da análise pré-jogo (puro Python, sem banco nem I/O).

Tudo aqui trabalha só com os dados que o app já tem (chutes reais do Understat, minutos, médias da
liga) — nenhum treino de modelo e nenhum dado histórico novo. Cada função é determinística e
testável isoladamente.

Métodos:

* **Poisson** — chance de k eventos numa partida (``poisson_pmf`` / ``poisson_at_least``).
* **Binomial negativa** — contagens "irregulares" (chutes, escanteios) em que a variância passa da
  média; estima a dispersão por método dos momentos, encolhida para um valor a priori
  (``estimate_dispersion`` / ``nb_pmf`` / ``nb_at_least``).
* **Suavização bayesiana (gama-Poisson / beta-binomial)** — puxa taxas de amostras pequenas para uma
  referência (``shrink_rate`` / ``shrink_proportion``).
* **Cadeia de probabilidades** — gols = chutes x P(no alvo | chute) x P(gol | no alvo), com cada taxa
  condicional suavizada (``shot_chain``).
* **Percentil, Z-score e Z robusto (MAD)** — posição do jogador no grupo comparável
  (``percentile_rank`` / ``z_score`` / ``robust_z``).
* **Média móvel ponderada** — pesos decrescentes para a forma recente, mantendo o desempenho
  estrutural da temporada em separado (``weighted_mean`` / ``form_trend``).
* **Placar, 1x2 e faixas** — matriz de placares (Poisson), Over 2,5, ambos marcam e faixa 10–90%
  de contagens (``score_matrix`` / ``outcome_probs`` / ``quantile_range`` / ``blend_rate``).
* **Perfil de jogador** — similaridade entre perfis de notas 0-100 (``profile_similarity``).
* **Análise de sensibilidade** — recalcula a previsão em cenários favorável / base / conservador e
  mede o quanto ela balança (``sensitivity``).
"""
from __future__ import annotations

import math
from typing import Callable, Dict, List, Optional, Sequence, Tuple

# --------------------------------------------------------------------------- constantes
# Dispersão a priori (alfa da binomial negativa: Var = mu + alfa * mu^2). Contagens de chutes por
# jogador em futebol costumam ficar entre 0,05 e 0,35; 0,12 é um valor conservador.
DISPERSION_PRIOR = 0.12
DISPERSION_PRIOR_WEIGHT = 4.0     # "jogadores-jogo" que o a priori vale frente aos dados
DISPERSION_MAX = 0.6
MAX_K = 40                         # corte da soma da distribuição (probabilidade acumulada ~1)


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


# --------------------------------------------------------------------------- Poisson
def poisson_pmf(k: int, lam: float) -> float:
    """P(X = k) com X ~ Poisson(lam)."""
    lam = max(0.0, lam)
    if k < 0:
        return 0.0
    if lam == 0.0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam + k * math.log(lam) - math.lgamma(k + 1))


def poisson_at_least(k: int, lam: float) -> float:
    """P(X >= k) com X ~ Poisson(lam)."""
    if k <= 0:
        return 1.0
    return clamp(1.0 - sum(poisson_pmf(i, lam) for i in range(k)))


# --------------------------------------------------------------------------- binomial negativa
def nb_pmf(k: int, mu: float, alpha: float) -> float:
    """P(X = k) da binomial negativa com média ``mu`` e variância ``mu + alpha * mu^2``.

    ``alpha`` -> 0 reproduz a Poisson.
    """
    mu = max(0.0, mu)
    if k < 0:
        return 0.0
    if alpha <= 1e-6:
        return poisson_pmf(k, mu)
    if mu == 0.0:
        return 1.0 if k == 0 else 0.0
    r = 1.0 / alpha                      # "número de sucessos"
    p = r / (r + mu)                     # probabilidade de "sucesso" em cada tentativa
    log_pmf = (math.lgamma(k + r) - math.lgamma(r) - math.lgamma(k + 1)
               + r * math.log(p) + k * math.log(1.0 - p))
    return math.exp(log_pmf)


def nb_at_least(k: int, mu: float, alpha: float) -> float:
    """P(X >= k) na binomial negativa (fecha em forma analítica para k = 1)."""
    if k <= 0:
        return 1.0
    mu = max(0.0, mu)
    if alpha <= 1e-6:
        return poisson_at_least(k, mu)
    if k == 1:
        return clamp(1.0 - (1.0 + alpha * mu) ** (-1.0 / alpha))
    return clamp(1.0 - sum(nb_pmf(i, mu, alpha) for i in range(k)))


def count_distribution(mu: float, alpha: float = 0.0, top: int = 3) -> List[float]:
    """``[P(0), P(1), ..., P(top-1), P(>= top)]`` — pronta para exibir em barras."""
    probs = [nb_pmf(i, mu, alpha) for i in range(top)]
    probs.append(clamp(1.0 - sum(probs)))
    return probs


def estimate_dispersion(samples: Sequence[Sequence[float]],
                        prior: float = DISPERSION_PRIOR,
                        prior_weight: float = DISPERSION_PRIOR_WEIGHT) -> float:
    """Alfa da binomial negativa por método dos momentos, agregando vários jogadores.

    Cada elemento de ``samples`` é a contagem POR PARTIDA de um jogador (zeros incluídos).
    Para cada um, ``var - média`` estima ``alfa * média^2``; somando os jogadores e dividindo pela
    soma de ``média^2`` obtém-se um alfa estável para o time. O resultado é encolhido para
    ``prior`` conforme a quantidade de partidas observadas (poucas partidas = mais a priori).
    """
    num = 0.0
    den = 0.0
    games = 0
    for counts in samples:
        n = len(counts)
        if n < 4:
            continue
        mean = sum(counts) / n
        if mean <= 0:
            continue
        var = sum((c - mean) ** 2 for c in counts) / (n - 1)
        num += var - mean
        den += mean * mean
        games += n
    if den <= 0 or games == 0:
        return prior
    raw = max(0.0, num / den)
    w = games / (games + prior_weight * 10.0)   # 40 partidas observadas -> peso 0,5
    return clamp(w * raw + (1.0 - w) * prior, 0.0, DISPERSION_MAX)


# --------------------------------------------------------------------------- suavização bayesiana
def shrink_rate(observed_total: float, exposure: float, prior_rate: float, prior_exposure: float) -> float:
    """Taxa gama-Poisson: (total + prior_rate * k) / (exposição + k).

    ``exposure`` e ``prior_exposure`` na mesma unidade (jogos de 90', partidas...). Amostra pequena
    fica perto de ``prior_rate``; amostra grande preserva a taxa do jogador.
    """
    den = exposure + prior_exposure
    if den <= 0:
        return max(0.0, prior_rate)
    return max(0.0, (observed_total + prior_rate * prior_exposure) / den)


def shrink_proportion(successes: float, trials: float, prior_p: float, prior_trials: float) -> float:
    """Proporção beta-binomial: (sucessos + p0 * k) / (tentativas + k)."""
    den = trials + prior_trials
    if den <= 0:
        return clamp(prior_p)
    return clamp((successes + prior_p * prior_trials) / den)


def shot_chain(shots_rate: float, shots: float, on_target: float, goals_signal: float,
               prior_sot: float, prior_goal: float,
               sot_strength: float = 8.0, goal_strength: float = 6.0) -> Dict[str, float]:
    """Cadeia de probabilidades de um jogador.

    ``gols/jogo = chutes/jogo x P(no alvo | chute) x P(gol | no alvo)``

    * ``shots_rate`` — chutes esperados por jogo (já suavizado/ajustado por minutos).
    * ``shots``, ``on_target`` — chutes e chutes no alvo observados na janela.
    * ``goals_signal`` — "gols" observados na janela (mistura de gols e xG).
    * ``prior_sot`` — fração no alvo de referência (média do time).
    * ``prior_goal`` — fração de gol por chute no alvo de referência (média do time).

    Cada razão é suavizada por beta-binomial: quem tem 3 chutes não vira "100% no alvo".
    Retorna as duas proporções e as taxas por jogo resultantes.
    """
    p_sot = shrink_proportion(on_target, shots, prior_sot, sot_strength)
    p_goal = shrink_proportion(min(goals_signal, on_target), on_target, prior_goal, goal_strength)
    sot_rate = max(0.0, shots_rate) * p_sot
    return {"p_on_target": p_sot, "p_goal_given_sot": p_goal,
            "sot_rate": sot_rate, "goal_rate": sot_rate * p_goal}


# --------------------------------------------------------------------------- estatística descritiva
def mean_std(values: Sequence[float]) -> Tuple[float, float]:
    vals = [float(v) for v in values]
    if not vals:
        return 0.0, 0.0
    m = sum(vals) / len(vals)
    if len(vals) < 2:
        return m, 0.0
    var = sum((v - m) ** 2 for v in vals) / (len(vals) - 1)
    return m, math.sqrt(var)


def median(values: Sequence[float]) -> float:
    vals = sorted(float(v) for v in values)
    n = len(vals)
    if n == 0:
        return 0.0
    mid = n // 2
    return vals[mid] if n % 2 else (vals[mid - 1] + vals[mid]) / 2.0


def mad(values: Sequence[float]) -> float:
    """Desvio absoluto mediano (não normalizado)."""
    if not values:
        return 0.0
    med = median(values)
    return median([abs(float(v) - med) for v in values])


def z_score(x: float, peers: Sequence[float]) -> Optional[float]:
    """Z = (x - média) / desvio-padrão do grupo. ``None`` sem dispersão no grupo."""
    m, s = mean_std(peers)
    if s <= 1e-12:
        return None
    return (x - m) / s


def robust_z(x: float, peers: Sequence[float]) -> Optional[float]:
    """Z robusto: 0,6745 * (x - mediana) / MAD — quase imune a valores extremos do grupo."""
    d = mad(peers)
    if d <= 1e-12:
        return None
    return 0.6745 * (x - median(peers)) / d


def percentile_rank(x: float, peers: Sequence[float]) -> Optional[float]:
    """Percentil 0-100 (empates contam metade) de ``x`` no grupo ``peers``."""
    vals = [float(v) for v in peers]
    if not vals:
        return None
    below = sum(1 for v in vals if v < x)
    equal = sum(1 for v in vals if v == x)
    return 100.0 * (below + 0.5 * equal) / len(vals)


def z_to_percentile(z: float) -> float:
    """Percentil (0-100) de um Z numa normal padrão."""
    return 100.0 * 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


# --------------------------------------------------------------------------- média ponderada / forma
def weighted_mean(values: Sequence[float], weights: Sequence[float]) -> float:
    """M = sum(w_i x_i) / sum(w_i)."""
    den = sum(weights)
    if den <= 0:
        return 0.0
    return sum(w * v for w, v in zip(weights, values)) / den


def linear_weights(n: int) -> List[float]:
    """Pesos decrescentes lineares da partida mais recente (n) à mais antiga (1)."""
    return [float(n - i) for i in range(n)]


def form_trend(values_desc: Sequence[float], recent_n: int = 5,
               tolerance: float = 0.15) -> Dict[str, object]:
    """Desempenho ESTRUTURAL (todas as partidas, pesos iguais) x MOMENTO (últimas ``recent_n``,
    pesos lineares decrescentes). ``values_desc`` vem da partida mais recente para a mais antiga.

    ``trend``: ``up`` / ``down`` / ``stable`` pela diferença relativa (com folga ``tolerance``).
    """
    vals = [float(v) for v in values_desc]
    if not vals:
        return {"structural": 0.0, "recent": 0.0, "delta_pct": 0.0, "trend": "stable", "n": 0}
    structural = sum(vals) / len(vals)
    recent_vals = vals[:recent_n]
    recent = weighted_mean(recent_vals, linear_weights(len(recent_vals)))
    if len(vals) < max(4, recent_n - 1) or structural <= 1e-9:
        delta = 0.0
    else:
        delta = (recent - structural) / structural
    trend = "up" if delta >= tolerance else ("down" if delta <= -tolerance else "stable")
    return {"structural": structural, "recent": recent, "delta_pct": delta * 100.0,
            "trend": trend, "n": len(vals)}


# --------------------------------------------------------------------------- sensibilidade
def sensitivity(compute: Callable[[float, float], float],
                favorable: Tuple[float, float] = (1.15, 1.10),
                conservative: Tuple[float, float] = (0.85, 0.90),
                stable_range: float = 0.10,
                fragile_range: float = 0.20) -> Dict[str, object]:
    """Análise de sensibilidade de uma previsão.

    ``compute(rate_mult, ctx_mult)`` devolve a probabilidade (0-1) depois de multiplicar a taxa
    base do jogador (``rate_mult``: incerteza da amostra/minutos) e o contexto (``ctx_mult``: defesa
    adversária, mando, goleiro). Os cenários favorável/conservador movem os dois juntos.

    Retorna as três probabilidades, a amplitude (favorável - conservador) e o nível:
    ``stable`` (<= ``stable_range``), ``moderate`` ou ``sensitive`` (>= ``fragile_range``).
    Não são probabilidades "igualmente prováveis": são cenários condicionais.
    """
    base = compute(1.0, 1.0)
    fav = compute(*favorable)
    con = compute(*conservative)
    spread = max(0.0, fav - con)
    level = "stable" if spread <= stable_range else ("sensitive" if spread >= fragile_range else "moderate")
    # peso de cada driver: variação isolada da probabilidade (em pontos percentuais)
    drivers = {
        "amostra": round(100.0 * (compute(favorable[0], 1.0) - compute(conservative[0], 1.0)), 1),
        "contexto": round(100.0 * (compute(1.0, favorable[1]) - compute(1.0, conservative[1])), 1),
    }
    return {
        "favorable": round(fav, 4), "base": round(base, 4), "conservative": round(con, 4),
        "spread": round(spread, 4), "level": level, "drivers": drivers,
    }


# --------------------------------------------------------------------------- relatório pré-jogo e comparação de jogadores
PRIOR_MATCHES = 3.0          # "jogos fictícios" que suavizam a força de um time (igual a shot_insights.PRIOR_MATCHES)
MAX_GOALS = 8


def shrunk_ratio(total: float, n_matches: float, baseline_per_match: float, prior: float = PRIOR_MATCHES) -> float:
    """Razão suavizada de um time contra a média da liga (1,0 = média): ``shrink_rate`` dividido pela média."""
    if baseline_per_match <= 1e-9:
        return 1.0
    return shrink_rate(total, n_matches, baseline_per_match, prior) / baseline_per_match


def blend_rate(for_total: float, n_for: float, against_total: float, n_against: float,
               baseline: float, mult: float = 1.0, prior: float = PRIOR_MATCHES) -> Tuple[float, float, float]:
    """Taxa esperada de um time contra outro: ``média da liga x ataque x defesa adversária x mando``.

    Devolve ``(taxa, força_do_ataque, fraqueza_da_defesa_adversária)``; as razões já vêm suavizadas.
    """
    att = shrunk_ratio(for_total, n_for, baseline, prior)
    dfn = shrunk_ratio(against_total, n_against, baseline, prior)
    return max(0.0, baseline * att * dfn * mult), att, dfn


def quantile_range(mean: float, alpha: float = 0.0, lo: float = 0.10, hi: float = 0.90,
                   max_k: int = 80) -> Tuple[int, int]:
    """Faixa ``[lo, hi]`` (padrão 10%–90%) de uma contagem Poisson (``alpha`` = 0) ou binomial negativa."""
    if mean <= 0:
        return 0, 0
    cum, low, high = 0.0, None, None
    for k in range(max_k + 1):
        cum += nb_pmf(k, mean, alpha)
        if low is None and cum >= lo:
            low = k
        if cum >= hi:
            high = k
            break
    return (low or 0), (high if high is not None else max_k)


def score_matrix(lam_home: float, lam_away: float, max_goals: int = MAX_GOALS) -> List[List[float]]:
    """``m[h][a]`` = P(placar h x a): gols independentes (Poisson), renormalizada no corte ``max_goals``."""
    ph = [poisson_pmf(k, lam_home) for k in range(max_goals + 1)]
    pa = [poisson_pmf(k, lam_away) for k in range(max_goals + 1)]
    total = sum(ph) * sum(pa)
    if total <= 0:
        return [[0.0] * (max_goals + 1) for _ in range(max_goals + 1)]
    return [[(h * a) / total for a in pa] for h in ph]


def outcome_probs(matrix: Sequence[Sequence[float]], top: int = 3) -> Dict[str, object]:
    """Vitória/empate/derrota, Over 2,5, ambos marcam e os placares mais prováveis."""
    home = draw = away = over = btts = 0.0
    scores: List[Tuple[float, str]] = []
    for h, row in enumerate(matrix):
        for a, p in enumerate(row):
            if h > a:
                home += p
            elif h == a:
                draw += p
            else:
                away += p
            if h + a >= 3:
                over += p
            if h > 0 and a > 0:
                btts += p
            scores.append((p, f"{h}-{a}"))
    scores.sort(reverse=True)
    return {"home": home, "draw": draw, "away": away, "over_2_5": over, "btts": btts,
            "top_scores": [{"score": s, "p": p} for p, s in scores[:top]]}


def profile_similarity(a: Sequence[Optional[float]], b: Sequence[Optional[float]], min_axes: int = 3) -> Optional[float]:
    """Similaridade 0-100 entre dois vetores de notas 0-100 (100 = perfis iguais), nas dimensões em
    que os dois têm nota. Menos de ``min_axes`` em comum devolve ``None``."""
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < min_axes:
        return None
    rms = math.sqrt(sum((x - y) ** 2 for x, y in pairs) / len(pairs))
    return max(0.0, 100.0 - rms)
