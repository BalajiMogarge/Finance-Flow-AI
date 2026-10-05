"""initial_schema

Revision ID: 45ba9372002a
Revises: 
Create Date: 2026-10-06 00:20:03.470048

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '45ba9372002a'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema, supporting both fresh and existing databases."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'organizations' not in tables:
        op.create_table('organizations',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.PrimaryKeyConstraint('id')
        )

    if 'users' not in tables:
        op.create_table('users',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('email', sa.String(length=255), nullable=False),
            sa.Column('hashed_password', sa.String(length=255), nullable=False),
            sa.Column('full_name', sa.String(length=255), nullable=True),
            sa.Column('role', sa.String(length=32), nullable=False),
            sa.Column('is_active', sa.Boolean(), nullable=False),
            sa.Column('organization_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    if 'invoices' not in tables:
        op.create_table('invoices',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('organization_id', sa.Integer(), nullable=True),
            sa.Column('filename', sa.String(length=255), nullable=True),
            sa.Column('storage_key', sa.String(length=255), nullable=True),
            sa.Column('storage_type', sa.String(length=32), nullable=False, server_default='local'),
            sa.Column('is_ephemeral', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('file_hash', sa.String(length=64), nullable=True),
            sa.Column('vendor', sa.String(length=255), nullable=True),
            sa.Column('invoice_number', sa.String(length=128), nullable=True),
            sa.Column('gstin', sa.String(length=32), nullable=True),
            sa.Column('total', sa.Float(), nullable=True),
            sa.Column('decision', sa.String(length=32), nullable=True),
            sa.Column('confidence', sa.Float(), nullable=True),
            sa.Column('risk_level', sa.String(length=16), nullable=True),
            sa.Column('is_duplicate', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('reviewed_by', sa.Integer(), nullable=True),
            sa.Column('reviewed_at', sa.DateTime(), nullable=True),
            sa.Column('review_notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('invoices', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_invoices_decision'), ['decision'], unique=False)
            batch_op.create_index(batch_op.f('ix_invoices_file_hash'), ['file_hash'], unique=False)
            batch_op.create_index(batch_op.f('ix_invoices_invoice_number'), ['invoice_number'], unique=False)
            batch_op.create_index(batch_op.f('ix_invoices_vendor'), ['vendor'], unique=False)
    else:
        existing_cols = {c['name'] for c in inspector.get_columns('invoices')}
        with op.batch_alter_table('invoices', schema=None) as batch_op:
            if 'organization_id' not in existing_cols:
                batch_op.add_column(sa.Column('organization_id', sa.Integer(), nullable=True))
                batch_op.create_foreign_key('fk_invoices_organization', 'organizations', ['organization_id'], ['id'], ondelete='CASCADE')
            if 'storage_key' not in existing_cols:
                batch_op.add_column(sa.Column('storage_key', sa.String(length=255), nullable=True))
            if 'storage_type' not in existing_cols:
                batch_op.add_column(sa.Column('storage_type', sa.String(length=32), nullable=False, server_default='local'))
            if 'is_ephemeral' not in existing_cols:
                batch_op.add_column(sa.Column('is_ephemeral', sa.Boolean(), nullable=False, server_default=sa.false()))
            if 'file_hash' not in existing_cols:
                batch_op.add_column(sa.Column('file_hash', sa.String(length=64), nullable=True))
                batch_op.create_index(batch_op.f('ix_invoices_file_hash'), ['file_hash'], unique=False)
            if 'is_duplicate' not in existing_cols:
                batch_op.add_column(sa.Column('is_duplicate', sa.Boolean(), nullable=False, server_default=sa.false()))
            if 'reviewed_by' not in existing_cols:
                batch_op.add_column(sa.Column('reviewed_by', sa.Integer(), nullable=True))
                batch_op.create_foreign_key('fk_invoices_reviewer', 'users', ['reviewed_by'], ['id'], ondelete='SET NULL')
            if 'reviewed_at' not in existing_cols:
                batch_op.add_column(sa.Column('reviewed_at', sa.DateTime(), nullable=True))
            if 'review_notes' not in existing_cols:
                batch_op.add_column(sa.Column('review_notes', sa.Text(), nullable=True))

    if 'audit_logs' not in tables:
        op.create_table('audit_logs',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('invoice_id', sa.Integer(), nullable=True),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('action', sa.String(length=64), nullable=False),
            sa.Column('previous_state', sa.String(length=64), nullable=True),
            sa.Column('new_state', sa.String(length=64), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('audit_logs')
    op.drop_table('invoices')
    op.drop_table('users')
    op.drop_table('organizations')
