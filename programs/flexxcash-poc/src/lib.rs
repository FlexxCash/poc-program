use anchor_lang::prelude::*;

declare_id!("CUt9wANdS6L7jhD7y3SYfksaKfmXrCk2HicFW3Bq2Ldd");

#[program]
pub mod flexxcash_poc {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}