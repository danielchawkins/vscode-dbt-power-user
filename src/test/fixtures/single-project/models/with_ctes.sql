with first_cte as (
    select 1 as id
),

second_cte as (
    select id from first_cte
)

select * from second_cte
