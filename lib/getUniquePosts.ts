export function getUniquePosts(data:any[]){

return Array.from(

new Map(

data.map((item:any)=>[
`${item.employee_id}-${item["Post ID"]}`,
item
])

).values()

);

}