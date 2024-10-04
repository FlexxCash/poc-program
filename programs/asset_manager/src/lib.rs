use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use solana_program::pubkey::Pubkey;

declare_id!("91hM5ZdHVbH7tH1a21QHRmPEFkHWS532DfcpGPBUkdAF");

#[program]
pub mod asset_manager {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, jupsol_mint: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.is_initialized = true;
        state.is_paused = false;
        state.jupsol_mint = jupsol_mint;
        state.authority = ctx.accounts.authority.key();
        Ok(())
    }

    pub fn pause_system(ctx: Context<PauseSystem>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.state.authority,
            AssetManagerError::UnauthorizedAccount
        );
        ctx.accounts.state.is_paused = true;
        Ok(())
    }

    pub fn unpause_system(ctx: Context<PauseSystem>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.state.authority,
            AssetManagerError::UnauthorizedAccount
        );
        ctx.accounts.state.is_paused = false;
        Ok(())
    }

    pub fn deposit_asset(ctx: Context<DepositAsset>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.state.is_paused, AssetManagerError::SystemPaused);
        require!(ctx.accounts.asset_mint.key() == ctx.accounts.state.jupsol_mint, AssetManagerError::InvalidAssetType);
        require!(amount > 0, AssetManagerError::InvalidAmount);

        let asset_price = get_asset_price(&ctx.accounts.oracle, &ctx.accounts.asset_mint.key())?;

        let deposit_value = (amount as u128)
            .checked_mul(asset_price as u128)
            .ok_or(AssetManagerError::CalculationError)?
            .checked_div(10u128.pow(ctx.accounts.asset_mint.decimals as u32) as u128)
            .ok_or(AssetManagerError::CalculationError)?;

        require!(ctx.accounts.user_asset_account.amount >= amount, AssetManagerError::InsufficientBalance);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_asset_account.to_account_info(),
            to: ctx.accounts.vault_asset_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        ctx.accounts.user_deposit.amount = ctx.accounts.user_deposit.amount
            .checked_add(deposit_value as u64)
            .ok_or(AssetManagerError::CalculationError)?;

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
            value: deposit_value as u64,
        });

        msg!("Deposit successful: {} tokens deposited, value: {}", amount, deposit_value);

        Ok(())
    }

    pub fn mint_and_distribute_xxusd(ctx: Context<MintAndDistributeXxUSD>, asset_value: u64, product_price: u64) -> Result<()> {
        require!(!ctx.accounts.state.is_paused, AssetManagerError::SystemPaused);

        let total_xxusd_amount = asset_value;
        let locked_xxusd_amount = product_price;
        let user_xxusd_amount = total_xxusd_amount
            .checked_sub(locked_xxusd_amount)
            .ok_or(AssetManagerError::CalculationError)?;

        // Check minting limit
        require!(
            total_xxusd_amount <= ctx.accounts.state.minting_limit,
            AssetManagerError::MintingLimitExceeded
        );

        // Mint xxUSD
        let seeds = &[
            ctx.accounts.state.to_account_info().key.as_ref(),
            &[ctx.accounts.state.nonce],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::MintTo {
            mint: ctx.accounts.xxusd_mint.to_account_info(),
            to: ctx.accounts.xxusd_vault.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::mint_to(cpi_ctx, total_xxusd_amount)?;

        // TODO: Implement locking logic with LockManager contract

        // Transfer xxUSD to user
        let transfer_accounts = token::Transfer {
            from: ctx.accounts.xxusd_vault.to_account_info(),
            to: ctx.accounts.user_xxusd_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
            signer
        );
        token::transfer(transfer_ctx, user_xxusd_amount)?;

        // Update user deposit record
        ctx.accounts.user_deposit.xxusd_amount = ctx.accounts.user_deposit.xxusd_amount
            .checked_add(user_xxusd_amount)
            .ok_or(AssetManagerError::CalculationError)?;

        emit!(MintAndDistributeEvent {
            user: ctx.accounts.user.key(),
            total_amount: total_xxusd_amount,
            locked_amount: locked_xxusd_amount,
            user_amount: user_xxusd_amount,
        });

        msg!("xxUSD minted and distributed: total {}, locked {}, user {}", total_xxusd_amount, locked_xxusd_amount, user_xxusd_amount);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 8 + 32 + 32 + 8 + 1)]
    pub state: Account<'info, ProgramState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PauseSystem<'info> {
    #[account(mut)]
    pub state: Account<'info, ProgramState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct DepositAsset<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_asset_account.owner == user.key() @ AssetManagerError::UnauthorizedAccount,
        constraint = user_asset_account.mint == asset_mint.key() @ AssetManagerError::InvalidAssetAccount
    )]
    pub user_asset_account: Account<'info, TokenAccount>,
    pub asset_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", asset_mint.key().as_ref()],
        bump
    )]
    pub vault_asset_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 8 + 8,
        seeds = [b"user_deposit", user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(constraint = state.is_initialized @ AssetManagerError::UninitializedState)]
    pub state: Account<'info, ProgramState>,
    /// CHECK: This account is not read or written in this instruction
    pub oracle: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintAndDistributeXxUSD<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub xxusd_mint: Account<'info, Mint>,
    #[account(mut)]
    pub xxusd_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_xxusd_account: Account<'info, TokenAccount>,
    /// CHECK: This account is used as the mint authority
    #[account(seeds = [state.to_account_info().key.as_ref()], bump = state.nonce)]
    pub mint_authority: AccountInfo<'info>,
    /// CHECK: This account is used as the vault authority
    #[account(seeds = [state.to_account_info().key.as_ref()], bump = state.nonce)]
    pub vault_authority: AccountInfo<'info>,
    #[account(mut)]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(constraint = state.is_initialized @ AssetManagerError::UninitializedState)]
    pub state: Account<'info, ProgramState>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct UserDeposit {
    pub amount: u64,
    pub xxusd_amount: u64,
}

#[account]
pub struct ProgramState {
    pub is_initialized: bool,
    pub is_paused: bool,
    pub jupsol_mint: Pubkey,
    pub authority: Pubkey,
    pub minting_limit: u64,
    pub nonce: u8,
}

#[error_code]
pub enum AssetManagerError {
    #[msg("System is paused")]
    SystemPaused,
    #[msg("Invalid asset type")]
    InvalidAssetType,
    #[msg("Calculation error")]
    CalculationError,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Unauthorized account")]
    UnauthorizedAccount,
    #[msg("Invalid asset account")]
    InvalidAssetAccount,
    #[msg("Uninitialized state")]
    UninitializedState,
    #[msg("Oracle error")]
    OracleError,
    #[msg("Minting limit exceeded")]
    MintingLimitExceeded,
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub value: u64,
}

#[event]
pub struct MintAndDistributeEvent {
    pub user: Pubkey,
    pub total_amount: u64,
    pub locked_amount: u64,
    pub user_amount: u64,
}

fn get_asset_price(oracle: &AccountInfo, asset_mint: &Pubkey) -> Result<u64> {
    // TODO: Implement actual Oracle price fetching logic
    msg!("Fetching price from Oracle for asset: {}", asset_mint);
    Ok(1_000_000) // 假設價格，實際應從 Oracle 獲取
}