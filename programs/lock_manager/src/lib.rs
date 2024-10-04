use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("AmP3jbYmGguEcmfr6ies1doxrvWQSWaB5Y37pN7Jowu1");

#[program]
pub mod lock_manager {
    use super::*;

    pub fn lock_xxusd(
        ctx: Context<LockXxUSD>,
        amount: u64,
        lock_period: u64,
        daily_release: u64,
    ) -> Result<()> {
        // 驗證輸入參數
        require!(amount > 0, LockManagerError::InvalidAmount);
        require!(lock_period > 0, LockManagerError::InvalidLockPeriod);
        require!(daily_release > 0, LockManagerError::InvalidDailyRelease);
        require!(
            amount >= daily_release * lock_period,
            LockManagerError::InvalidLockParameters
        );

        // 檢查用戶餘額
        let user_balance = ctx.accounts.user_token_account.amount;
        require!(user_balance >= amount, LockManagerError::InsufficientBalance);

        // 創建鎖定記錄
        let lock_record = &mut ctx.accounts.lock_record;
        lock_record.owner = ctx.accounts.user.key();
        lock_record.amount = amount;
        lock_record.lock_period = lock_period;
        lock_record.daily_release = daily_release;
        lock_record.start_time = Clock::get()?.unix_timestamp;
        lock_record.last_release_time = lock_record.start_time;

        // 轉移 xxUSD 到鎖定合約地址
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.lock_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // 發出鎖定事件
        emit!(LockEvent {
            user: ctx.accounts.user.key(),
            amount,
            lock_period,
            daily_release,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct LockXxUSD<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = xxusd_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    pub xxusd_mint: Account<'info, token::Mint>,
    #[account(
        mut,
        associated_token::mint = xxusd_mint,
        associated_token::authority = lock_manager,
    )]
    pub lock_vault: Account<'info, TokenAccount>,
    /// CHECK: This is the LockManager PDA
    #[account(seeds = [b"lock_manager"], bump)]
    pub lock_manager: AccountInfo<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 8 + 8 + 8 + 8 + 8,
        seeds = [b"lock_record", user.key().as_ref()],
        bump
    )]
    pub lock_record: Account<'info, LockRecord>,
    /// CHECK: This is the AssetManager program
    #[account(constraint = asset_manager.key() == ASSET_MANAGER_PROGRAM_ID @ LockManagerError::InvalidAssetManager)]
    pub asset_manager: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct LockRecord {
    pub owner: Pubkey,
    pub amount: u64,
    pub lock_period: u64,
    pub daily_release: u64,
    pub start_time: i64,
    pub last_release_time: i64,
}

#[error_code]
pub enum LockManagerError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid lock period")]
    InvalidLockPeriod,
    #[msg("Invalid daily release amount")]
    InvalidDailyRelease,
    #[msg("Invalid lock parameters")]
    InvalidLockParameters,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Invalid asset manager")]
    InvalidAssetManager,
}

#[event]
pub struct LockEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub lock_period: u64,
    pub daily_release: u64,
}

// 替換為實際的 AssetManager 程序 ID
pub const ASSET_MANAGER_PROGRAM_ID: Pubkey = solana_program::pubkey!("91hM5ZdHVbH7tH1a21QHRmPEFkHWS532DfcpGPBUkdAF");