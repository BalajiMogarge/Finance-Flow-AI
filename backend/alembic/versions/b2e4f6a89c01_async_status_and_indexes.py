"""async_status_and_indexes

Revision ID: b2e4f6a89c01
Revises: 45ba9372002a
Create Date: 2026-10-12 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2e4f6a89c01'
down_revision: Union[str, Sequence[str], None] = '45ba9372002a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add async lifecycle columns and compound indexes to invoices."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {c['name'] for c in inspector.get_columns('invoices')}
    existing_indexes = {i['name'] for i in inspector.get_indexes('invoices')}

    with op.batch_alter_table('invoices', schema=None) as batch_op:
        if 'status' not in existing_cols:
            batch_op.add_column(
                sa.Column('status', sa.String(length=32), nullable=False, server_default='completed')
            )
        if 'error_reason' not in existing_cols:
            batch_op.add_column(
                sa.Column('error_reason', sa.Text(), nullable=True)
            )
        if 'sha256' not in existing_cols:
            batch_op.add_column(
                sa.Column('sha256', sa.String(length=64), nullable=True)
            )
        if 'extracted_data' not in existing_cols:
            batch_op.add_column(
                sa.Column('extracted_data', sa.Text(), nullable=True)
            )

        if 'uq_invoices_org_sha256' not in existing_indexes:
            batch_op.create_index('uq_invoices_org_sha256', ['organization_id', 'sha256'], unique=True)
        if 'ix_invoices_org_created_at' not in existing_indexes:
            batch_op.create_index('ix_invoices_org_created_at', ['organization_id', 'created_at'], unique=False)
        if 'ix_invoices_org_status' not in existing_indexes:
            batch_op.create_index('ix_invoices_org_status', ['organization_id', 'status'], unique=False)


def downgrade() -> None:
    """Revert async lifecycle columns and indexes."""
    with op.batch_alter_table('invoices', schema=None) as batch_op:
        batch_op.drop_index('ix_invoices_org_status')
        batch_op.drop_index('ix_invoices_org_created_at')
        batch_op.drop_index('uq_invoices_org_sha256')
        batch_op.drop_column('extracted_data')
        batch_op.drop_column('sha256')
        batch_op.drop_column('error_reason')
        batch_op.drop_column('status')
