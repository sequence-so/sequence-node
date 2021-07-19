## Sequence Node SDK
Send data into Sequence using this library.

```
yarn add sequence-node
```

```
npm install sequence-node
```

### Track Usage:
```
import Sequence from 'sequence-node';
const analytics = new Sequence(process.env.SEQUENCE_API_KEY)
analytics.track({
  // id of user (required)
  userId: 'my-user-id',
  // event name (required)
  event: 'User Registered',
  // properties associated with event
  properties: {
    firstName: 'John',
    lastName: 'Smith'
  },
  // original event date
  timestamp: new Date()
})
```

### Identify Usage
```
analytics.identify({
  // id of user (required)
  userId: 'my-user-id',
  // traits associated with the user
  traits: {
    firstName: 'John',
    lastName: 'Smith'
  }
})
```
### Supported Events
- Identify: https://segment.com/docs/connections/spec/identify/
- Track: https://segment.com/docs/connections/spec/track/