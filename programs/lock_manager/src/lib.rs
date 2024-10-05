use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("ESvCxW7pEH5EdGVmgue3LMGV5kbpRKhwRskYiBSEjzxz");

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

    pub fn release_daily_xxusd(ctx: Context<ReleaseDailyXxUSD>) -> Result<()> {
        let lock_record = &mut ctx.accounts.lock_record;
        let current_time = Clock::get()?.unix_timestamp;

        // 驗證所有者
        require!(lock_record.owner == ctx.accounts.user.key(), LockManagerError::InvalidOwner);

        // 檢查鎖定期是否已結束
        require!(
            current_time < lock_record.start_time + (lock_record.lock_period as i64 * 86400),
            LockManagerError::LockPeriodEnded
        );

        // 確保每日只能釋放一次
        let last_release_date = lock_record.last_release_time / 86400;
        let current_date = current_time / 86400;
        require!(last_release_date < current_date, LockManagerError::AlreadyReleasedToday);

        // 計算可釋放的金額
        let days_since_last_release = (current_time - lock_record.last_release_time) / 86400;
        let releasable_amount = lock_record.daily_release.saturating_mul(days_since_last_release as u64);
        let remaining_locked_amount = lock_record.amount;

        let release_amount = releasable_amount.min(remaining_locked_amount);

        require!(release_amount > 0, LockManagerError::NoAmountToRelease);

        // 更新鎖定記錄
        lock_record.amount = lock_record.amount.saturating_sub(release_amount);
        lock_record.last_release_time = current_time;

        // 轉移釋放的 xxUSD 到用戶帳戶
        let seeds = &[
            b"lock_manager".as_ref(),
            &[ctx.bumps.lock_manager],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.lock_vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.lock_manager.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, release_amount)?;

        // 發出釋放事件
        emit!(ReleaseEvent {
            user: ctx.accounts.user.key(),
            amount: release_amount,
        });

        Ok(())
    }

    pub fn check_lock_status(ctx: Context<CheckLockStatus>) -> Result<LockStatus> {
        let lock_record = &ctx.accounts.lock_record;
        let current_time = Clock::get()?.unix_timestamp;

        let is_locked = current_time < lock_record.start_time + (lock_record.lock_period as i64 * 86400);
        let remaining_lock_time = if is_locked {
            (lock_record.start_time + (lock_record.lock_period as i64 * 86400)) - current_time
        } else {
            0
        };

        let days_since_start = (current_time - lock_record.start_time) / 86400;
        let redeemable_amount = lock_record.daily_release.saturating_mul(days_since_start as u64).min(lock_record.amount);

        let redemption_deadline = lock_record.start_time + ((lock_record.lock_period as i64 + 14) * 86400);

        Ok(LockStatus {
            is_locked,
            remaining_lock_time,
            redeemable_amount,
            redemption_deadline,
        })
    }

    pub fn is_within_redemption_window(ctx: Context<CheckRedemptionWindow>) -> Result<bool> {
        let lock_record = &ctx.accounts.lock_record;
        let current_time = Clock::get()?.unix_timestamp;

        // 計算鎖定期結束時間
        let lock_end_time = lock_record.start_time + (lock_record.lock_period as i64 * 86400);
        
        // 計算贖回窗口結束時間（鎖定期結束後14天）
        let redemption_end_time = lock_end_time + (14 * 86400);

        // 檢查當前時間是否在贖回窗口內
        let is_within_window = current_time >= lock_end_time && current_time <= redemption_end_time;

        // 發出事件以記錄檢查結果
        emit!(RedemptionWindowCheckEvent {
            user: ctx.accounts.user.key(),
            is_within_window,
            current_time,
            lock_end_time,
            redemption_end_time,
        });

        Ok(is_within_window)
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

#[derive(Accounts)]
pub struct ReleaseDailyXxUSD<'info> {
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
        mut,
        seeds = [b"lock_record", user.key().as_ref()],
        bump,
    )]
    pub lock_record: Account<'info, LockRecord>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CheckLockStatus<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"lock_record", user.key().as_ref()],
        bump,
        constraint = lock_record.owner == user.key() @ LockManagerError::InvalidOwner,
    )]
    pub lock_record: Account<'info, LockRecord>,
}

#[derive(Accounts)]
pub struct CheckRedemptionWindow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        seeds = [b"lock_record", user.key().as_ref()],
        bump,
        constraint = lock_record.owner == user.key() @ LockManagerError::InvalidOwner,
    )]
    pub lock_record: Account<'info, LockRecord>,
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct LockStatus {
    pub is_locked: bool,
    pub remaining_lock_time: i64,
    pub redeemable_amount: u64,
    pub redemption_deadline: i64,
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
    #[msg("No amount to release")]
    NoAmountToRelease,
    #[msg("Invalid owner")]
    InvalidOwner,
    #[msg("Lock period has ended")]
    LockPeriodEnded,
    #[msg("Already released today")]
    AlreadyReleasedToday,
}

#[event]
pub struct LockEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub lock_period: u64,
    pub daily_release: u64,
}

#[event]
pub struct ReleaseEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RedemptionWindowCheckEvent {
    pub user: Pubkey,
    pub is_within_window: bool,
    pub current_time: i64,
    pub lock_end_time: i64,
    pub redemption_end_time: i64,
}

// 替換為實際的 AssetManager 程序 ID
pub const ASSET_MANAGER_PROGRAM_ID: Pubkey = solana_program::pubkey!("91hM5ZdHVbH7tH1a21QHRmPEFkHWS532DfcpGPBUkdAF");