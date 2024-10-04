use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use switchboard_on_demand::on_demand::accounts::pull_feed::PullFeedAccountData;
use switchboard_on_demand::prelude::rust_decimal::prelude::ToPrimitive;

declare_id!("CzpZdoxJhQjtzG7oLgTHinsPjtMFVzRXEYWy1pn3wQ9Z");

#[program]
pub mod price_oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let oracle_account = &mut ctx.accounts.oracle_account;
        oracle_account.authority = *ctx.accounts.authority.key;
        oracle_account.feed = *ctx.accounts.feed.key;
        oracle_account.last_update_timestamp = 0;
        oracle_account.cached_price = 0;
        
        msg!("Oracle initialized");
        
        Ok(())
    }

    pub fn get_price(ctx: Context<GetPrice>, asset: String) -> Result<u64> {
        let oracle_account = &mut ctx.accounts.oracle_account;
        
        // 獲取當前時鐘
        let clock = Clock::get()?;

        // 檢查是否初始化
        require!(oracle_account.authority != Pubkey::default(), PriceOracleError::NotInitialized);

        // 檢查資產名稱是否為空
        require!(!asset.is_empty(), PriceOracleError::InvalidAsset);

        // 檢查緩存的價格是否仍然有效
        if clock.unix_timestamp - oracle_account.last_update_timestamp <= 60 {
            msg!("Returning cached price for asset: {}, price: {}", asset, oracle_account.cached_price);
            return Ok(oracle_account.cached_price);
        }

        // 獲取新的價格
        let feed_account = ctx.accounts.feed.data.borrow();
        let feed = PullFeedAccountData::parse(feed_account).map_err(|_| PriceOracleError::PriceFetchFailed)?;
        let price = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

        // 轉換價格為 u64 並檢查是否成功
        let price_u64 = price.to_u64().ok_or(PriceOracleError::PriceConversionFailed)?;

        // 檢查價格是否為零
        require!(price_u64 > 0, PriceOracleError::ZeroPrice);

        // 更新緩存的價格
        oracle_account.cached_price = price_u64;
        oracle_account.last_update_timestamp = clock.unix_timestamp;

        msg!("New price fetched and cached for asset: {}, price: {}", asset, price_u64);

        Ok(price_u64)
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 32 + 8 + 8)]
    pub oracle_account: Account<'info, OracleAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: This is the Switchboard feed account, which is validated in the instruction logic
    pub feed: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    #[account(mut)]
    pub oracle_account: Account<'info, OracleAccount>,
    /// CHECK: This is the Switchboard feed account, which is validated in the instruction logic
    pub feed: AccountInfo<'info>,
}

#[account]
pub struct OracleAccount {
    pub authority: Pubkey,
    pub feed: Pubkey,
    pub last_update_timestamp: i64,
    pub cached_price: u64,
}

#[error_code]
pub enum PriceOracleError {
    #[msg("Not Initialized")]
    NotInitialized,
    #[msg("Price Fetch Failed")]
    PriceFetchFailed,
    #[msg("Price Conversion Failed")]
    PriceConversionFailed,
    #[msg("Invalid Asset")]
    InvalidAsset,
    #[msg("Zero Price")]
    ZeroPrice,
}