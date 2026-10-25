"""Crest/logo fallback for teams whose data source does not provide one.

StatsBomb Open Data does not ship club/national-team crests. This module
provides a small curated catalog of stable crest URLs for the national teams
that Scout imports, plus a resolver that prefers an already-stored logo_url.
Teams without an entry fall back to ``None`` and the frontend renders initials.
"""
from typing import Optional

_CRESTS: dict[str, str] = {
    "argentina": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Logo_of_the_Argentina_national_football_team.svg/200px-Logo_of_the_Argentina_national_football_team.svg.png",
    "france": "https://upload.wikimedia.org/wikipedia/fr/thumb/1/12/Logo_FFF.svg/200px-Logo_FFF.svg.png",
    "croatia": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/HNS_logo.svg/200px-HNS_logo.svg.png",
    "brazil": "https://upload.wikimedia.org/wikipedia/pt/thumb/4/45/CBF_logo.svg/200px-CBF_logo.svg.png",
    "england": "https://upload.wikimedia.org/wikipedia/en/thumb/6/64/England_crest_2009.svg/200px-England_crest_2009.svg.png",
    "spain": "https://upload.wikimedia.org/wikipedia/en/thumb/3/31/Royal_Spanish_Football_Federation_logo.svg/200px-Royal_Spanish_Football_Federation_logo.svg.png",
    "portugal": "https://upload.wikimedia.org/wikipedia/pt/thumb/5/5a/Portuguese_Football_Federation_logo.svg/200px-Portuguese_Football_Federation_logo.svg.png",
    "netherlands": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/KNVB_logo.svg/200px-KNVB_logo.svg.png",
    "germany": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/DFB-Logo.svg/200px-DFB-Logo.svg.png",
    "belgium": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Royal_Belgian_FA_logo.svg/200px-Royal_Belgian_FA_logo.svg.png",
    "morocco": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Royal_Moroccan_Football_Federation_logo.svg/200px-Royal_Moroccan_Football_Federation_logo.svg.png",
    "japan": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/JFA_logo.svg/200px-JFA_logo.svg.png",
    "united states": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/United_States_Soccer_Federation_logo.svg/200px-United_States_Soccer_Federation_logo.svg.png",
    "mexico": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Federaci%C3%B3n_Mexicana_de_F%C3%BAtbol_logo.svg/200px-Federaci%C3%B3n_Mexicana_de_F%C3%BAtbol_logo.svg.png",
    "qatar": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Qatar_Football_Association_logo.svg/200px-Qatar_Football_Association_logo.svg.png",
    "uruguay": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/AUF_logo.svg/200px-AUF_logo.svg.png",
    "switzerland": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Swiss_Football_Association_logo.svg/200px-Swiss_Football_Association_logo.svg.png",
    "senegal": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/F%C3%A9d%C3%A9ration_S%C3%A9n%C3%A9galaise_de_Football_logo.svg/200px-F%C3%A9d%C3%A9ration_S%C3%A9n%C3%A9galaise_de_Football_logo.svg.png",
    "poland": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Polish_Football_Association_logo.svg/200px-Polish_Football_Association_logo.svg.png",
    "serbia": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Football_Association_of_Serbia_logo.svg/200px-Football_Association_of_Serbia_logo.svg.png",
    "wales": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Football_Association_of_Wales_logo.svg/200px-Football_Association_of_Wales_logo.svg.png",
    "australia": "https://upload.wikimedia.org/wikipedia/en/thumb/8/8b/Football_Australia_logo.svg/200px-Football_Australia_logo.svg.png",
    "ecuador": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/FEF_logo.svg/200px-FEF_logo.svg.png",
    "ghana": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Ghana_Football_Association_logo.svg/200px-Ghana_Football_Association_logo.svg.png",
    "cameroon": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/F%C3%A9d%C3%A9ration_Camerounaise_de_Football_logo.svg/200px-F%C3%A9d%C3%A9ration_Camerounaise_de_Football_logo.svg.png",
    "tunisia": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/F%C3%A9d%C3%A9ration_Tunisienne_de_Football_logo.svg/200px-F%C3%A9d%C3%A9ration_Tunisienne_de_Football_logo.svg.png",
    "denmark": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Danish_Football_Association_logo.svg/200px-Danish_Football_Association_logo.svg.png",
    "korea republic": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Korea_Football_Association_logo.svg/200px-Korea_Football_Association_logo.svg.png",
    "south korea": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Korea_Football_Association_logo.svg/200px-Korea_Football_Association_logo.svg.png",
    "iran": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Football_Federation_Islamic_Republic_of_Iran_logo.svg/200px-Football_Federation_Islamic_Republic_of_Iran_logo.svg.png",
    "saudi arabia": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Saudi_Arabian_Football_Federation_logo.svg/200px-Saudi_Arabian_Football_Federation_logo.svg.png",
    "costa rica": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Federaci%C3%B3n_Costarricense_de_F%C3%BAtbol_logo.svg/200px-Federaci%C3%B3n_Costarricense_de_F%C3%BAtbol_logo.svg.png",
    "canada": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Canada_Soccer_logo.svg/200px-Canada_Soccer_logo.svg.png",
    # Clubes europeus (fallback para times sem logo armazenado)
    "vfb stuttgart": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/VfB_Stuttgart_Logo.svg/200px-VfB_Stuttgart_Logo.svg.png",
    "borussia mönchengladbach": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/81/Borussia_M%C3%B6nchengladbach_logo.svg/200px-Borussia_M%C3%B6nchengladbach_logo.svg.png",
    "aj auxerre": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2f/Nouveau_logo_aja.png/200px-Nouveau_logo_aja.png",
    "le havre ac": "https://thumb.wikimedia.org/wikipedia/fr/thumb/e/ef/Logo_Le_Havre_AC_Omnisports.svg/200px-Logo_Le_Havre_AC_Omnisports.svg.png",
    # Premier League
    "manchester city": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Manchester_City_FC_badge.svg/200px-Manchester_City_FC_badge.svg.png",
    "arsenal": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Arsenal_FC.svg/200px-Arsenal_FC.svg.png",
    "brighton": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Brighton_%26_Hove_Albion_FC_logo.svg/200px-Brighton_%26_Hove_Albion_FC_logo.svg.png",
    "chelsea": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Chelsea_FC.svg/200px-Chelsea_FC.svg.png",
    "liverpool": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Liverpool_FC.svg/200px-Liverpool_FC.svg.png",
    "brentford": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Brentford_FC.svg/200px-Brentford_FC.svg.png",
    "leeds united": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Leeds_United_FC.svg/200px-Leeds_United_FC.svg.png",
    "leeds": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Leeds_United_FC.svg/200px-Leeds_United_FC.svg.png",
    "everton": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Everton_FC.svg/200px-Everton_FC.svg.png",
    "hull city": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Hull_City_AFC_logo.svg/200px-Hull_City_AFC_logo.svg.png",
    "ipswich town": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Ipswich_Town_FC_logo.svg/200px-Ipswich_Town_FC_logo.svg.png",
    "newcastle united": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Newcastle_United_FC_crest.svg/200px-Newcastle_United_FC_crest.svg.png",
    "aston villa": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Aston_Villa_FC_crest.svg/200px-Aston_Villa_FC_crest.svg.png",
    "manchester united": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Manchester_United_FC_crest.svg/200px-Manchester_United_FC_crest.svg.png",
    "tottenham": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Tottenham_Hotspur_FC.svg/200px-Tottenham_Hotspur_FC.svg.png",
    "west ham": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/West_Ham_United_FC.svg/200px-West_Ham_United_FC.svg.png",
    "fulham": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Fulham_FC.svg/200px-Fulham_FC.svg.png",
    "crystal palace": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Crystal_Palace_FC_2022_logo.svg/200px-Crystal_Palace_FC_2022_logo.svg.png",
    "bournemouth": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/AFC_Bournemouth.svg/200px-AFC_Bournemouth.svg.png",
    "nottingham forest": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Nottingham_Forest_FC.svg/200px-Nottingham_Forest_FC.svg.png",
    "wolverhampton wanderers": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Wolverhampton_Wanderers_FC.svg/200px-Wolverhampton_Wanderers_FC.svg.png",
    "southampton": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Southampton_FC.svg/200px-Southampton_FC.svg.png",
    "leicester city": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Leicester_City_FC.svg/200px-Leicester_City_FC.svg.png",
    # Bundesliga
    "fc köln": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/1._FC_K%C3%B6ln_logo.svg/200px-1._FC_K%C3%B6ln_logo.svg.png",
    "1. fc köln": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/1._FC_K%C3%B6ln_logo.svg/200px-1._FC_K%C3%B6ln_logo.svg.png",
    "1. fc union berlin": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/1._FC_Union_Berlin_logo.svg/200px-1._FC_Union_Berlin_logo.svg.png",
    "1. fsv mainz 05": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/1._FSV_Mainz_05_logo.svg/200px-1._FSV_Mainz_05_logo.svg.png",
    "bayer 04 leverkusen": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Bayer_04_Leverkusen_logo.svg/200px-Bayer_04_Leverkusen_logo.svg.png",
    "borussia dortmund": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Borussia_Dortmund_logo.svg/200px-Borussia_Dortmund_logo.svg.png",
    "eintracht frankfurt": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Eintracht_Frankfurt_logo.svg/200px-Eintracht_Frankfurt_logo.svg.png",
    "fc augsburg": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/FC_Augsburg_logo.svg/200px-FC_Augsburg_logo.svg.png",
    "fc bayern münchen": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/FC_Bayern_M%C3%BCnchen_logo.svg/200px-FC_Bayern_M%C3%BCnchen_logo.svg.png",
    "fc bayern munchen": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/FC_Bayern_M%C3%BCnchen_logo.svg/200px-FC_Bayern_M%C3%BCnchen_logo.svg.png",
    # La Liga
    "athletic club": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Athletic_Club_bilbao.svg/200px-Athletic_Club_bilbao.svg.png",
    "atlético madrid": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Atletico_Madrid_2017.svg/200px-Atletico_Madrid_2017.svg.png",
    "atletico madrid": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Atletico_Madrid_2017.svg/200px-Atletico_Madrid_2017.svg.png",
    "fc barcelona": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/FC_Barcelona_%28crest%29.svg/200px-FC_Barcelona_%28crest%29.svg.png",
    "barcelona": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/FC_Barcelona_%28crest%29.svg/200px-FC_Barcelona_%28crest%29.svg.png",
    "real madrid": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Real_Madrid_CF.svg/200px-Real_Madrid_CF.svg.png",
    "getafe": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Getafe_CF_logo.svg/200px-Getafe_CF_logo.svg.png",
    "getafe cf": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Getafe_CF_logo.svg/200px-Getafe_CF_logo.svg.png",
    "valencia cf": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Valencia_CF_logo.svg/200px-Valencia_CF_logo.svg.png",
    "sevilla fc": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Sevilla_FC_logo.svg/200px-Sevilla_FC_logo.svg.png",
    # Serie A
    "inter milan": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Inter_Milan.svg/200px-Inter_Milan.svg.png",
    "fc inter milan": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Inter_Milan.svg/200px-Inter_Milan.svg.png",
    "ac milan": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/AC_Milan.svg/200px-AC_Milan.svg.png",
    "juventus": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Juventus_FC.svg/200px-Juventus_FC.svg.png",
    "atalanta": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Atalanta_BC_logo.svg/200px-Atalanta_BC_logo.svg.png",
    "atalanta bc": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Atalanta_BC_logo.svg/200px-Atalanta_BC_logo.svg.png",
    "acf fiorentina": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/ACF_Fiorentina.svg/200px-ACF_Fiorentina.svg.png",
    "fiorentina": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/ACF_Fiorentina.svg/200px-ACF_Fiorentina.svg.png",
    "genoa": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Genoa_CFC_logo.svg/200px-Genoa_CFC_logo.svg.png",
    "genoa cf c": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Genoa_CFC_logo.svg/200px-Genoa_CFC_logo.svg.png",
    "venezia fc": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Venezia_FC_logo.svg/200px-Venezia_FC_logo.svg.png",
    "venezia": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Venezia_FC_logo.svg/200px-Venezia_FC_logo.svg.png",
    "torino": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Torino_FC_logo.svg/200px-Torino_FC_logo.svg.png",
    "torino fc": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Torino_FC_logo.svg/200px-Torino_FC_logo.svg.png",
    # Ligue 1
    "brest": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Stade_Brestois_29_logo.svg/200px-Stade_Brestois_29_logo.svg.png",
    "nice": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/OGC_Nice_logo.svg/200px-OGC_Nice_logo.svg.png",
    "ogc nice": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/OGC_Nice_logo.svg/200px-OGC_Nice_logo.svg.png",
    "monza": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/AC_Monza_logo.svg/200px-AC_Monza_logo.svg.png",
    "ac monza": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/AC_Monza_logo.svg/200px-AC_Monza_logo.svg.png",
}


def _normalize(name: Optional[str]) -> str:
    return (name or "").strip().lower()


def crest_for_name(name: Optional[str]) -> Optional[str]:
    return _CRESTS.get(_normalize(name))


def resolve_crest(name: Optional[str], logo_url: Optional[str]) -> Optional[str]:
    """Prefer an already-stored logo_url; fall back to the curated catalog."""
    if logo_url:
        return logo_url
    return crest_for_name(name)