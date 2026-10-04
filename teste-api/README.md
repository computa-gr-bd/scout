# teste-api — Coleta de dados reais (football-data.org)

Ferramenta que coleta dados reais da API **football-data.org v4** e os salva em
`data/` (CSV + JSON brutos). Esses dados alimentam o frontend do ScoutVision.

## 1. Coletar (opcional, precisa de token)

```bash
cd teste-api
pip install -r requirements.txt

# token gratuito: https://www.football-data.org/client/register
set FOOTBALL_DATA_TOKEN=SEU_TOKEN          # Windows
python football_data_collector.py --competitions BSA --days 14 --outdir data
```

Gera, entre outros:

| Arquivo | Conteúdo |
|---|---|
| `data/BSA_standings.csv` | classificação da Série A |
| `data/BSA_scorers.csv` | artilheiros da temporada |
| `data/BSA_upcoming_matches.csv` | próximas partidas |
| `data/BSA_matches_raw.json` | payload bruto (times + escudos + datas) |

## 2. Tratar / consumir no projeto (frontend)

Os dados coletados já estão **tratados** em dois módulos TS:

- `frontend/src/api/footballDataOrg.ts` — dados normalizados (tabela,
  artilheiros, calendário e metadados de times/escudos).
- `frontend/src/api/studioData.ts` — transforma esses dados em:
  - `API_MATCHES` → partidas reais no tipo `Match` (aparecem na lista de
    partidas, exatamente como as partidas "mockadas");
  - `STUDIO_DATASETS` → "jogos" do **ScoutVision Studio** (heatmap, chutes,
    gols e posições), gerados de forma determinística (seed = id da partida).

No Studio (`frontend/src/components/PitchStudio.tsx`) há um **seletor de
partida**: escolha entre o jogo *demo* (Flamengo × Palmeiras) e os jogos reais
vindos da API para alternar os dados ao vivo.

> Ao rodar a coleta novamente, atualize os arrays em
> `frontend/src/api/footballDataOrg.ts` com os novos valores (tabela,
> artilheiros e próximas partidas).

## 3. Testes

```bash
cd teste-api
python -m unittest -v
```