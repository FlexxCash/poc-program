use anchor_lang::prelude::*;

declare_id!("4xR6HSSBrPcvbuJ5ZwmRyXYnsNfUkoCRmvexFq2qqcjp");

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