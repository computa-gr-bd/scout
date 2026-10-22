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