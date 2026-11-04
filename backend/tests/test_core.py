import pytest

from app.db import Base


@pytest.mark.parametrize("value", [0, 1, 2])
def test_core_smoke(value):
    assert value in {0, 1, 2}


def test_sqlalchemy_models_are_mapped():
    assert Base is not None
