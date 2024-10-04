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
        // 檢查系統是否處於暫停狀態
        require!(!ctx.accounts.state.is_paused, AssetManagerError::SystemPaused);

        // 驗證資產類型的有效性
        require!(ctx.accounts.asset_mint.key() == ctx.accounts.state.jupsol_mint, AssetManagerError::InvalidAssetType);

        // 驗證存款金額
        require!(amount > 0, AssetManagerError::InvalidAmount);

        // 調用 Oracle 合約獲取當前資產價格
        let asset_price = get_asset_price(&ctx.accounts.oracle, &ctx.accounts.asset_mint.key())?;

        // 計算存入資產的總價值
        let deposit_value = (amount as u128)
            .checked_mul(asset_price as u128)
            .ok_or(AssetManagerError::CalculationError)?
            .checked_div(10u128.pow(ctx.accounts.asset_mint.decimals as u32) as u128)
            .ok_or(AssetManagerError::CalculationError)?;

        // 檢查用戶賬戶餘額
        require!(ctx.accounts.user_asset_account.amount >= amount, AssetManagerError::InsufficientBalance);

        // 將資產轉移到合約賬戶
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_asset_account.to_account_info(),
            to: ctx.accounts.vault_asset_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // 更新用戶在合約中的資產餘額
        ctx.accounts.user_deposit.amount = ctx.accounts.user_deposit.amount
            .checked_add(deposit_value as u64)
            .ok_or(AssetManagerError::CalculationError)?;

        // 發出存款事件
        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
            value: deposit_value as u64,
        });

        msg!("Deposit successful: {} tokens deposited, value: {}", amount, deposit_value);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 8 + 32 + 32)]
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
        space = 8 + 8,
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

#[account]
pub struct UserDeposit {
    pub amount: u64,
}

#[account]
pub struct ProgramState {
    pub is_initialized: bool,
    pub is_paused: bool,
    pub jupsol_mint: Pubkey,
    pub authority: Pubkey,
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
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub value: u64,
}

// 這個函數需要根據實際的 Oracle 實現來完成
fn get_asset_price(oracle: &AccountInfo, asset_mint: &Pubkey) -> Result<u64> {
    // TODO: Implement actual Oracle price fetching logic
    msg!("Fetching price from Oracle for asset: {}", asset_mint);
    Ok(1_000_000) // 假設價格，實際應從 Oracle 獲取
}