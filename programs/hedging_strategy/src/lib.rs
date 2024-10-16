use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

declare_id!("HqrUNQ7jUcKg1h2jhrYmKcM5HJY49uEMzV69dD1NYtHU");

#[program]
pub mod hedging_strategy {
    use super::*;

    pub fn initialize_system_state(ctx: Context<InitializeSystemState>) -> Result<()> {
        ctx.accounts.system_state.is_paused = false;
        Ok(())
    }

    pub fn pause_system(ctx: Context<PauseSystem>) -> Result<()> {
        ctx.accounts.system_state.is_paused = true;
        Ok(())
    }

    pub fn unpause_system(ctx: Context<PauseSystem>) -> Result<()> {
        ctx.accounts.system_state.is_paused = false;
        Ok(())
    }

    pub fn manage_hedging(ctx: Context<ManageHedging>, amount: u64) -> Result<()> {
        // 檢查系統是否處於暫停狀態
        require!(!ctx.accounts.system_state.is_paused, HedgingError::SystemPaused);

        // 檢查金額是否有效
        require!(amount > 0, HedgingError::InvalidAmount);

        // 檢查用戶餘額是否足夠
        require!(ctx.accounts.user_token_account.amount >= amount, HedgingError::InsufficientBalance);

        // 1. 接收用戶傳入的資產
        let user_token_account = &mut ctx.accounts.user_token_account;
        let hedging_vault = &mut ctx.accounts.hedging_vault;

        // 2. 將資產存入借貸平台（這裡簡化為轉移到 hedging_vault）
        let cpi_accounts = token::Transfer {
            from: user_token_account.to_account_info(),
            to: hedging_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // 3. 轉換資產或美金穩定幣進行對沖
        // 目前簡化為"存入即對沖"策略，不進行實際的資產轉換
        // TODO: 實現實際的資產轉換邏輯

        // 4. 從借貸平台取出資產
        // 目前簡化處理，實際上資產已經在 hedging_vault 中
        // TODO: 實現與實際借貸平台的交互邏輯

        // 5. 轉換資產回 SOL 或美金穩定幣
        // 目前簡化處理，不進行實際轉換
        // TODO: 實現與 DEX 的交互邏輯進行資產轉換

        // 6. 取出到指定地址
        // 目前簡化處理，資產保留在 hedging_vault 中
        // TODO: 實現將資產轉移到指定地址的邏輯

        let hedging_record = &mut ctx.accounts.hedging_record;
        hedging_record.user = ctx.accounts.user.key();
        hedging_record.amount = amount;
        hedging_record.timestamp = Clock::get()?.unix_timestamp;
        hedging_record.is_processing = true;

        // 模擬對沖操作完成
        hedging_record.is_processing = false;

        emit!(HedgingCompletedEvent {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: hedging_record.timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeSystemState<'info> {
    #[account(init, payer = authority, space = 8 + 1)]
    pub system_state: Account<'info, SystemState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PauseSystem<'info> {
    #[account(mut)]
    pub system_state: Account<'info, SystemState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ManageHedging<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ HedgingError::InvalidOwner
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub hedging_vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 8 + 8 + 1,  // 增加 1 byte 用於 is_processing
        seeds = [b"hedging_record", user.key().as_ref()],
        bump
    )]
    pub hedging_record: Account<'info, HedgingRecord>,
    pub system_state: Account<'info, SystemState>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct HedgingRecord {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub is_processing: bool,
}

#[account]
pub struct SystemState {
    pub is_paused: bool,
}

#[event]
pub struct HedgingCompletedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum HedgingError {
    #[msg("System is paused")]
    SystemPaused,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid owner")]
    InvalidOwner,
    #[msg("Hedging operation is already in progress")]
    HedgingInProgress,
}