"""baseline_schema

Revision ID: 36742fb45f0e
Revises: 
Create Date: 2026-10-11 02:26:06.618736

"""
from typing import Sequence, Union

from db import init_schema

# revision identifiers, used by Alembic.
revision: str = '36742fb45f0e'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Initialize core baseline tables."""
    init_schema()


def downgrade() -> None:
    pass
