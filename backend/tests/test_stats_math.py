"""Matemática estatística da análise (módulo puro): Poisson, Binomial Negativa, suavização, Z, forma, cenários."""
import math

from app.services import stats_math as sm


def test_poisson_matches_the_documented_example():
    # jogador com expectativa de 3,2 finalizações (exemplo da metodologia)
    assert round(100 * sm.poisson_pmf(0, 3.2), 2) == 4.08
    assert round(100 * sm.poisson_pmf(1, 3.2), 2) == 13.04
    assert round(100 * sm.poisson_pmf(2, 3.2), 2) == 20.87
    assert round(100 * sm.poisson_pmf(3, 3.2), 2) == 22.26
    assert round(100 * sm.poisson_at_least(4, 3.2), 1) == 39.7
    assert abs(sum(sm.poisson_pmf(k, 3.2) for k in range(80)) - 1.0) < 1e-9


def test_negative_binomial_keeps_mean_and_adds_variance():
    mu, alpha = 2.0, 0.3
    ks = range(300)
    mean = sum(k * sm.nb_pmf(k, mu, alpha) for k in ks)
    var = sum((k - mean) ** 2 * sm.nb_pmf(k, mu, alpha) for k in ks)
    assert abs(mean - mu) < 1e-6
    assert abs(var - (mu + alpha * mu * mu)) < 1e-4


def test_negative_binomial_reduces_to_poisson_and_has_more_zeros():
    assert abs(sm.nb_pmf(2, 1.7, 0.0) - sm.poisson_pmf(2, 1.7)) < 1e-12
    assert abs(sm.nb_at_least(1, 1.7, 1e-9) - sm.poisson_at_least(1, 1.7)) < 1e-6
    # irregularidade: mesma média, mais jogos zerados -> P(>=1) menor
    assert sm.nb_at_least(1, 1.7, 0.3) < sm.poisson_at_least(1, 1.7)
    assert abs(sm.nb_at_least(1, 1.7, 0.3) - (1 - sum(sm.nb_pmf(0, 1.7, 0.3) for _ in [0]))) < 1e-9


def test_count_distribution_sums_to_one():
    dist = sm.count_distribution(1.5, 0.2, top=3)
    assert len(dist) == 4 and abs(sum(dist) - 1.0) < 1e-9
    assert dist[3] == max(0.0, 1 - sum(dist[:3]))


def test_dispersion_estimate_is_shrunk_to_the_prior_with_little_data():
    steady = [[1, 1, 1, 2, 1, 1, 2, 1]] * 3        # regular: quase sem excesso de variância
    bursty = [[0, 0, 6, 0, 0, 7, 0, 0]] * 3        # irregular
    low, high = sm.estimate_dispersion(steady), sm.estimate_dispersion(bursty)
    assert low < sm.DISPERSION_PRIOR < high <= sm.DISPERSION_MAX
    assert sm.estimate_dispersion([]) == sm.DISPERSION_PRIOR
    assert sm.estimate_dispersion([[1, 2]]) == sm.DISPERSION_PRIOR   # menos de 4 partidas: ignora


def test_bayesian_shrinkage_pulls_small_samples_to_the_reference():
    league = 0.5
    small = sm.shrink_rate(observed_total=4, exposure=1.0, prior_rate=league, prior_exposure=2.0)   # 4 em 1 jogo
    large = sm.shrink_rate(observed_total=36, exposure=9.0, prior_rate=league, prior_exposure=2.0)  # 4 por jogo
    assert league < small < 4.0
    assert abs(large - 4.0) < abs(small - 4.0)        # amostra grande preserva mais a taxa do jogador
    assert sm.shrink_proportion(3, 3, 0.4, 8) < 0.6   # 3/3 no alvo NÃO vira 100%
    assert sm.shrink_proportion(0, 0, 0.4, 8) == 0.4


def test_shot_chain_multiplies_the_conditional_rates():
    c = sm.shot_chain(shots_rate=3.0, shots=30, on_target=15, goals_signal=6.0, prior_sot=0.4, prior_goal=0.3)
    assert abs(c["goal_rate"] - 3.0 * c["p_on_target"] * c["p_goal_given_sot"]) < 1e-12
    tiny = sm.shot_chain(3.0, 3, 3, 3.0, 0.4, 0.3)        # 3 chutes, 3 no alvo, 3 gols
    assert tiny["p_on_target"] < 0.7 and tiny["p_goal_given_sot"] < 0.7


def test_z_scores_and_percentile():
    peers = list(range(1, 11))
    assert sm.percentile_rank(5, peers) == 45.0
    assert abs(sm.z_score(5.5, peers)) < 1e-9
    assert sm.z_score(3, [2, 2, 2]) is None            # sem dispersão
    # um valor extremo infla o desvio-padrão, mas quase não mexe no MAD
    with_outlier = peers + [1000]
    assert abs(sm.robust_z(9, with_outlier)) > abs(sm.z_score(9, with_outlier))
    assert sm.mad([1, 2, 3, 4, 100]) == 1.0
    assert abs(sm.z_to_percentile(0.0) - 50.0) < 1e-9


def test_weighted_mean_and_form_trend():
    assert abs(sm.weighted_mean([10, 0], [3, 1]) - 7.5) < 1e-12
    assert sm.linear_weights(3) == [3.0, 2.0, 1.0]
    hot = sm.form_trend([3, 3, 2, 2, 2, 0, 0, 0, 0, 0])           # mais recente primeiro
    cold = sm.form_trend([0, 0, 0, 0, 0, 2, 2, 2, 3, 3])
    flat = sm.form_trend([1, 1, 1, 1, 1, 1, 1, 1])
    assert hot["trend"] == "up" and cold["trend"] == "down" and flat["trend"] == "stable"
    assert sm.form_trend([1, 2])["trend"] == "stable"             # poucas partidas: sem tendência
    assert sm.form_trend([])["n"] == 0


def test_sensitivity_scenarios_are_ordered_and_flag_fragile_forecasts():
    def forecast(rate):
        return lambda rm, cm: sm.poisson_at_least(1, rate * rm * cm)

    scen = sm.sensitivity(forecast(1.0), favorable=(1.1, 1.1), conservative=(0.9, 0.9))
    assert scen["conservative"] < scen["base"] < scen["favorable"]
    assert abs(scen["spread"] - (scen["favorable"] - scen["conservative"])) < 1e-3
    wide = sm.sensitivity(forecast(1.0), favorable=(1.5, 1.3), conservative=(0.5, 0.7))
    assert wide["level"] == "sensitive" and scen["level"] != "sensitive"
    assert set(scen["drivers"]) == {"amostra", "contexto"}
    assert math.isclose(scen["base"], sm.poisson_at_least(1, 1.0), abs_tol=1e-4)
