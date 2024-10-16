use anchor_lang::prelude::*;

declare_id!("AUQAHMVRQ9jkVJtGPr7Y32fF2boeGfAWLHLUQS2Dykik");

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